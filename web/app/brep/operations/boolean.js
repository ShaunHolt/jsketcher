import * as BREPBuilder from '../brep-builder';
import {BREPValidator} from '../brep-validator';
import {HalfEdge, Edge} from '../topo/edge';
import {Loop} from '../topo/loop';
import {Face} from '../topo/face';
import {Shell} from '../topo/shell';
import {Vertex} from '../topo/vertex';
import {Line} from '../geom/impl/line';
import Vector from '../../math/vector';
import * as math from '../../math/math';

export const TOLERANCE = 1e-8;
 export const TOLERANCE_SQ = TOLERANCE * TOLERANCE;
export const TOLERANCE_HALF = TOLERANCE * 0.5;

const DEBUG = {
  OPERANDS_MODE: false,
  LOOP_DETECTION: true,
  FACE_FACE_INTERSECTION: false,
  FACE_EDGE_INTERSECTION: false,
  SEWING: false,
  EDGE_MERGING: true,
  NOOP: () => {}
};

const TYPE = {
  UNION: 0,
  INTERSECT: 1,
  SUBTRACT: 2
};

export function union( shell1, shell2 ) {
  __DEBUG_OPERANDS(shell1, shell2);
  return BooleanAlgorithm(shell1, shell2, TYPE.UNION);
}

export function intersect( shell1, shell2 ) {
  __DEBUG_OPERANDS(shell1, shell2);
  return BooleanAlgorithm(shell1, shell2, TYPE.INTERSECT);
}

export function subtract( shell1, shell2 ) {
  __DEBUG_OPERANDS(shell1, shell2);
  invert(shell2);
  return BooleanAlgorithm(shell1, shell2, TYPE.SUBTRACT);
}

export function invert( shell ) {
  for (let face of shell.faces) {
    face.surface = face.surface.invert();
    face.data.INVERTED = !face.data.INVERTED;
    for (let loop of face.loops) {
      invertLoop(loop);
    }
  }
  BREPValidator.validateToConsole(shell);
}

function invertLoop(loop) {
  BREPBuilder.invertLoop(loop);
}

export function BooleanAlgorithm( shell1, shell2, type ) {

  POINT_TO_VERT.clear();

  let facesData = [];

  mergeVertices(shell1, shell2);

  initSolveData(shell1, facesData);
  initSolveData(shell2, facesData);

  intersectFaces(shell1, shell2, type !== TYPE.UNION);

  for (let faceData of facesData) {
    initGraph(faceData);
  }

  facesData = facesData.filter(fd => fd.merged !== true);

  const allFaces = [];
  const newLoops = new Set();
  for (let faceData of facesData) {
    const face = faceData.face;
    const loops = detectLoops(faceData.face);
    for (let loop of loops) {
      for (let edge of loop.halfEdges) {
        const isNew = EdgeSolveData.get(edge).newEdgeFlag === true;
        if (isNew) newLoops.add(loop);
      }
    }
    loopsToFaces(face, loops, allFaces);
  }
  let faces = allFaces;
  faces = filterFaces(faces, newLoops);
  const result = new Shell();
  faces.forEach(face => {
    face.shell = result;
    result.faces.push(face);
  });

  cleanUpSolveData(result);
  BREPValidator.validateToConsole(result);

  __DEBUG__.ClearVolumes();
  __DEBUG__.Clear();
  return result;
}

function detectLoops(face) {
  const faceData = face.data[MY];
  if (DEBUG.LOOP_DETECTION) {
    __DEBUG__.Clear();
    __DEBUG__.AddFace(face, 0x00ff00);
    DEBUG.NOOP();
  }

  const loops = [];
  const seen = new Set();
  let edges = [];
  for (let e of face.edges) edges.push(e);
  while (true) {
    let edge = edges.pop();
    if (!edge) {
      break;
    }
    if (seen.has(edge)) {
      continue;
    }
    const loop = new Loop();
    loop.face = face;
    let surface = EdgeSolveData.get(edge).transferedSurface;
    if (!surface) {
      surface = face.surface;
    }
    while (edge) {
      if (DEBUG.LOOP_DETECTION) {
        __DEBUG__.AddHalfEdge(edge);
      }
      loop.halfEdges.push(edge);
      seen.add(edge);
      let candidates = faceData.vertexToEdge.get(edge.vertexB);
      if (!candidates) {
        break;
      }
      edge = findMaxTurningLeft(edge, candidates, surface.normal);
      if (seen.has(edge)) {
        break;
      }
    }

    if (loop.halfEdges[0].vertexA == loop.halfEdges[loop.halfEdges.length - 1].vertexB) {
      for (let halfEdge of loop.halfEdges) {
        halfEdge.loop = loop;
      }

      BREPBuilder.linkSegments(loop.halfEdges);
      loops.push(loop);
    }
  }
  return loops;
}

function initGraph(faceData) {
  faceData.vertexToEdge.clear();
  for (let he of faceData.face.edges) {
    addToListInMap(faceData.vertexToEdge, he.vertexA, he);
  }
}

function edgeV(edge) {
  return edge.vertexB.point.minus(edge.vertexA.point)._normalize();
}

export function mergeVertices(shell1, shell2) {
  const toSwap = new Map();
  for (let v1 of shell1.vertices) {
    for (let v2 of shell2.vertices) {
      if (math.areVectorsEqual(v1.point, v2.point, TOLERANCE)) {
        toSwap.set(v2, v1);
      }
    }
  }

  for (let face of shell2.faces) {
    for (let h of face.edges) {
      const aSwap = toSwap.get(h.vertexA);
      const bSwap = toSwap.get(h.vertexB);
      if (aSwap) {
        h.vertexA = aSwap;
      }
      if (bSwap) {
        h.vertexB = bSwap;
      }
    }
  }
}

function squash(face, edges) {
  face.outerLoop = new Loop();
  face.outerLoop.face = face;
  edges.forEach(he => face.outerLoop.halfEdges.push(he));
  face.innerLoops = [];
}

function filterFaces(faces, newLoops, validLoops) {
  const validFaces = new Set(faces);
  const result = new Set();
  for (let face of faces) {
    traverseFaces(face, validFaces, (it) => {
      if (result.has(it) || isFaceContainNewLoop(it, newLoops)) {
        result.add(face);
        return true;
      }
    });
  }
  return result;
}

function isFaceContainNewLoop(face, newLoops) {
  for (let loop of face.loops) {
    if (newLoops.has(loop)) {
      return true;
    }
  }
  return false;
}

function traverseFaces(face, validFaces, callback) {
  const stack = [face];
  const seen = new Set();
  while (stack.length !== 0) {
    face = stack.pop();
    if (seen.has(face)) continue;
    seen.add(face);
    if (callback(face) === true) {
      return;
    }
    for (let loop of face.loops) {
      if (!validFaces.has(face)) continue;
      for (let halfEdge of loop.halfEdges) {
        const twin = halfEdge.twin();
        if (validFaces.has(twin.loop.face)) {
          stack.push(twin.loop.face)
        }
      }
    }
  }
}

export function loopsToFaces(originFace, loops, out) {
  const face = new Face(originFace.surface);
  face.innerLoops = loops;
  out.push(face);
}


function initSolveData(shell, facesData) {
  for (let face of shell.faces) {
    const solveData = new FaceSolveData(face);
    facesData.push(solveData);
    face.data[MY] = solveData;
    for (let he of face.edges) {
      EdgeSolveData.clear(he);
    }
  }
}

function cleanUpSolveData(shell) {
  for (let face of shell.faces) {
    delete face.data[MY];
    for (let he of face.edges) {
      EdgeSolveData.clear(he);
    }
  }
}

function findMaxTurningLeft(pivotEdge, edges, normal) {
  edges = edges.slice();
  function edgeVector(edge) {
    return edge.vertexB.point.minus(edge.vertexA.point)._normalize();
  }
  const pivot = pivotEdge.vertexA.point.minus(pivotEdge.vertexB.point)._normalize();
  edges.sort((e1, e2) => {
    return leftTurningMeasure(pivot, edgeVector(e1), normal) - leftTurningMeasure(pivot, edgeVector(e2), normal);
  });
  return edges[edges.length - 1];
}

function leftTurningMeasure(v1, v2, normal) {
  let measure = v1.dot(v2);
  if (v1.cross(v2).dot(normal) < 0) {
    measure = -(2 + measure);
  }
  measure -= 1;//shift to the zero

  //make it positive all the way
  return -measure;
}

function intersectFaces(shell1, shell2, inverse) {
  for (let i = 0; i < shell1.faces.length; i++) {
    const face1 = shell1.faces[i];
    if (DEBUG.FACE_FACE_INTERSECTION) {
      __DEBUG__.Clear(); __DEBUG__.AddFace(face1, 0x00ff00);
      DEBUG.NOOP();
    }
    for (let j = 0; j < shell2.faces.length; j++) {
      const face2 = shell2.faces[j];
      if (DEBUG.FACE_FACE_INTERSECTION) {
        __DEBUG__.Clear(); __DEBUG__.AddFace(face1, 0x00ff00);
        __DEBUG__.AddFace(face2, 0x0000ff);
        if (face1.refId == 0 && face2.refId == 0) {
          DEBUG.NOOP();
        }
      }

      let curves = face1.surface.intersect(face2.surface);
      if (inverse) {
        curves = curves.map(c => c.inverse());
      }

      const nodes = [];
      collectNodesOfIntersectionOfFace(curves, face1, nodes);
      collectNodesOfIntersectionOfFace(curves, face2, nodes);

      const newEdges = [];
      calculateNodeNormals(nodes, curves);
      filterNodes(nodes);
      split(nodes, newEdges, curves);

      newEdges.forEach(e => {
        addNewEdge(face1, e.halfEdge1);
        addNewEdge(face2, e.halfEdge2);
      });
    }
  }
}

function addNewEdge(face, halfEdge) {
  const data = face.data[MY];
  data.newEdges.push(halfEdge);
  halfEdge.loop = data.loopOfNew;
  EdgeSolveData.createIfEmpty(halfEdge).newEdgeFlag = true;
  //addToListInMap(data.vertexToEdge, halfEdge.vertexA, halfEdge);
  return true;
}

function calculateNodeNormals(nodes, curve) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n != null) {
      n.normal = nodeNormal(n.point, n.edge, curve);
      if (n.normal == 0) {
        nodes[i] = null;
      }
    }
  }
}

function filterNodes(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    const node1 = nodes[i];
    if (node1 == null) continue;
    for (let j = 0; j < nodes.length; j++) {
      if (i == j) continue;
      const node2 = nodes[j];
      if (node2 != null) {
        if (node2.vertex == node1.vertex) {
          if (node1.normal + node2.normal == 0) {
            nodes[i] = null
          }
          nodes[j] = null
        }
      }
    }
  }
}

function collectNodesOfIntersectionOfFace(curves, face, nodes) {
  for (let loop of face.loops) {
    collectNodesOfIntersection(curves, loop, nodes);
  }
}

function collectNodesOfIntersection(curves, loop, nodes) {
  for (let edge of loop.halfEdges) {
    intersectCurvesWithEdge(curves, edge, nodes);
  }
}

function intersectCurvesWithEdge(curves, edge, result) {
  const newSubcurves = [];
  for (let i = 0; i < curves.length; ++i) {
    let curve = curves[i];
    const points = edge.intersectCurve(curve);  
    for (let point of points) {
      if (!math.areEqual(point._param, 0, TOLERANCE) && !math.areEqual(point._param, 1, TOLERANCE)) {
        const subCurves = curve.split(point);
        curves[i] = curve = subCurves[1];
        newSubcurves.push(subCurves[0]);      
      }
      const node = new Node(newVertex(p), edge);
      result.push(node);
    }
  }
  for (let c of newSubcurves) {
    curves.push(c);
  }
}

function split(nodes, result, onCurve, direction) {
  for (let i = 0; i < nodes.length; i++) {
    let inNode = nodes[i];
    //if (i == 0)  __DEBUG__.AddPoint(inNode.vertex.point);

    if (inNode == null) continue;
    nodes[i] = null;
    let closestIdx = findCloserOnCurve(nodes, inNode, onCurve);
    if (closestIdx == -1) {
      continue;
    }
    let outNode = nodes[closestIdx];
    //if (i == 1)  __DEBUG__.AddPoint(outNode.vertex.point);
    //if (i == 1)  __DEBUG__.AddSegment(inNode.point, inNode.point.plus(inNode.normal.multiply(1000)));
    //__DEBUG__.AddSegment(new Vector(),  outNode.normal.multiply(100));

    if (outNode.normal * inNode.normal > 0) {
      continue;
    }

    nodes[closestIdx] = null;

    //__DEBUG__.AddPoint(inNode.vertex.point);
    //__DEBUG__.AddPoint(outNode.vertex.point);


    const halfEdge1 = new HalfEdge();
    halfEdge1.vertexA = inNode.vertex;
    halfEdge1.vertexB = outNode.vertex;

    const halfEdge2 = new HalfEdge();
    halfEdge2.vertexB = halfEdge1.vertexA;
    halfEdge2.vertexA = halfEdge1.vertexB;

    //__DEBUG__.AddHalfEdge(halfEdge1);
    //__DEBUG__.AddSegment(new Vector(),  direction.multiply(100));


    splitEdgeByVertex(inNode.edge, halfEdge1.vertexA, inNode.splittingFace);
    splitEdgeByVertex(outNode.edge, halfEdge1.vertexB, outNode.splittingFace);

    const sameDirection = direction.dot(outNode.point.minus(inNode.point)) > 0;

    const halfEdgeSameDir = sameDirection ? halfEdge1 : halfEdge2;
    const halfEdgeNegativeDir = sameDirection ? halfEdge2 : halfEdge1;

    // cross edge should go with negative dir for the first face and positive for the second
    const edge = new Edge(onCurve);
    edge.halfEdge1 = halfEdgeNegativeDir;
    edge.halfEdge2 = halfEdgeSameDir;
    halfEdgeNegativeDir.edge = edge;
    halfEdgeSameDir.edge = edge;

    //check for corner case when to faces only intersects in edges
    if (!containsEdges(result, edge)) {
      result.push(edge);
    }
  }
}

function splitEdgeByVertex(originHalfEdge, vertex, splittingFace) {

  function splitHalfEdge(h) {
    const newEdge = new HalfEdge();
    newEdge.vertexA = vertex;
    newEdge.vertexB = h.vertexB;
    h.vertexB = newEdge.vertexA;
    return newEdge;
  }

  const orig = originHalfEdge;
  const twin = orig.twin();

  if (orig.vertexA == vertex || orig.vertexB == vertex) {
    return;
  }

  const newOrig = splitHalfEdge(orig);
  const newTwin = splitHalfEdge(twin);


  BREPBuilder.linkHalfEdges(orig.edge, orig, newTwin);
  BREPBuilder.linkHalfEdges(new Edge(orig.edge.curve), twin, newOrig);

  orig.loop.halfEdges.splice(orig.loop.halfEdges.indexOf(orig) + 1, 0, newOrig);
  twin.loop.halfEdges.splice(twin.loop.halfEdges.indexOf(twin) + 1, 0, newTwin);

  newOrig.loop = orig.loop;
  newTwin.loop = twin.loop;

  EdgeSolveData.transfer(orig, newOrig);
  EdgeSolveData.transfer(twin, newTwin);

  //EdgeSolveData.createIfEmpty(twin).splitByFace.set(splittingFace, vertex);
  //EdgeSolveData.createIfEmpty(newTwin).skipFace.add(splittingFace);
}

function findCloserOnCurve(nodes, toNode, curve) {
  let hero = -1;
  let heroDistance = Number.MAX_VALUE;
  const origin = curve.t(toNode.point);
  for (let i = 0; i < nodes.length; i++) {
    let node = nodes[i];
    if (node == null) continue;
    let distance = (origin - curve.t(node.point)) * node.normal;
    if (distance < 0) continue;
    if (distance < heroDistance) {
      hero = i;
      heroDistance = distance;
    }
  }
  return hero;
}

const POINT_TO_VERT = new Map();
function newVertex(point) {
  let vertex = POINT_TO_VERT.get(point);
  if (!vertex) {
    vertex = new Vertex(point);
    duplicatePointTest(point);
    POINT_TO_VERT.set(point, vertex);
  }
  return vertex;
}

function nodeNormal(point, edge, curve) {
  const edgeTangent = edge.tangent(point);
  const curveTangent = curve.v; //todo @ point
  let dot = edgeTangent.dot(curveTangent);
  if (math.areEqual(dot, 0, TOLERANCE)) {
    dot = 0;
  } else {
    if (dot < 0) 
      dot = -1;
    else 
      dot = 1;
  }
  return dot;
}

function edgeNormal(edge) {
  throw 'unimplemented'
}

function EdgeSolveData() {
}

EdgeSolveData.EMPTY = new EdgeSolveData();

EdgeSolveData.get = function(edge) {
  if (!edge.data[MY]) {
    return EdgeSolveData.EMPTY;
  }
  return edge.data[MY];
};

EdgeSolveData.createIfEmpty = function(edge) {
  if (!edge.data[MY]) {
    edge.data[MY] = new EdgeSolveData();
  }
  return edge.data[MY];
};

EdgeSolveData.clear = function(edge) {
  delete edge.data[MY];
};

EdgeSolveData.transfer = function(from, to) {
  to.data[MY] = from.data[MY];
};

function Node(vertex, splitsEdge, splittingFace) {
  this.vertex = vertex;
  this.normal = 0;
  this.point = vertex.point;
  this.edge = splitsEdge;
  this.dir = null;
  this.curve = null;
  this.splittingFace = splittingFace;
  //__DEBUG__.AddPoint(this.point);
}


let __DEBUG_POINT_DUPS = [];
function duplicatePointTest(point, data) {
  data = data || {};
  let res = false;
  for (let entry of __DEBUG_POINT_DUPS) {
    let other = entry[0];
    if (math.areVectorsEqual(point, other, TOLERANCE)) {
      res = true;
      break;
    }
  }
  __DEBUG_POINT_DUPS.push([point, data]);
  if (res) {
    __DEBUG__.AddPoint(point);
    console.error('DUPLICATE DETECTED: ' + point)
  }
  return res;
}

class SolveData {
  constructor() {
    this.faceData = [];
  }
}

class FaceSolveData {
  constructor(face) {
    this.face = face;
    this.loopOfNew = new Loop();
    this.newEdges = this.loopOfNew.halfEdges;
    this.vertexToEdge = new Map();
    this.overlaps = new Set();
    this.loopOfNew.face = face;
  }
}

function addToListInMap(map, key, value) {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  list.push(value);
}

function removeFromListInMap(map, key, value) {
  let list = map.get(key);
  if (list) {
    const idx = list.indexOf(value);
    if (idx != -1) {
      list.splice(idx, 1);
    }
  }
}

function __DEBUG_OPERANDS(shell1, shell2) {
  if (DEBUG.OPERANDS_MODE) {
    __DEBUG__.HideSolids();
    __DEBUG__.AddVolume(shell1, 0x800080);
    __DEBUG__.AddVolume(shell2, 0xfff44f);
  }
}

const MY = '__BOOLEAN_ALGORITHM_DATA__'; 

