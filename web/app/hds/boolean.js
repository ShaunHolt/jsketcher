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
}

function invertLoop(loop) {
  throw 'unimplemeted';
}

export function BooleanAlgorithm( shell1, shell2, type ) {

  POINT_TO_VERT.clear();

  let faces = [];

  mergeVertices(shell1, shell2);

  collectFaces(shell1, faces);
  collectFaces(shell2, faces);

  const newEdges = intersectFaces(shell1, shell2, type !== TYPE.UNION);

  for (let hdsFace of faces) {
    initGraph(hdsFace);
  }

  const allFaces = [];
  const newLoops = new Set();
  for (let face of faces) {
    const loops = detectLoops(hdsFace.face);
    for (let loop of loops) {
      for (let edge of loop.edges) {
        const isNew = newEdges.has(edge);
        if (isNew) newLoops.add(loop);
      }
    }
    loopsToFaces(face, loops, allFaces);
  }
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
  const hdsFace = face.data[MY];
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
      loop.edges.push(edge);
      seen.add(edge);
      let candidates = hdsFace.graph.get(edge.b);
      if (!candidates) {
        break;
      }
      edge = findMaxTurningLeft(edge, candidates, surface.normal);
      if (seen.has(edge)) {
        break;
      }
    }

    if (loop.edges[0].a == loop.edges[loop.edges.length - 1].b) {
      for (let halfEdge of loop.edges) {
        halfEdge.loop = loop;
      }

      BREPBuilder.linkSegments(loop.edges);
      loops.push(loop);
    }
  }
  return loops;
}

function initGraph(face) {
  face.graph = new Map();
  for (let loop of face.loops) {
    for (let i = 0; i < loop.edges.length; i++) {    
      addToListInMap(face.graph, loop.edges[i], loop.edges[i + 1]);
    }
  }
}

function edgeV(edge) {
  return edge.b.point.minus(edge.a.point)._normalize();
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
      for (let halfEdge of loop.edges) {
        const twin = halfEdge.twin();
        if (validFaces.has(twin.loop.face)) {
          stack.push(twin.loop.face)
        }
      }
    }
  }
}

export function loopsToFaces(originFace, loops, out) {
  const originSurface = originFace.surface;
  let invertedSurface = null;
  function invertSurface(surface) {
    if (surface == originSurface) {
      if (invertedSurface == null) {
        invertedSurface = originSurface.invert();
      }
      return invertedSurface;
    } else {
      return originSurface;
    }
  }

  function createFaces(nestedLoop, surface, level) {
    if (!nestedLoop.loop.isCCW(surface)) {
      surface = invertSurface(surface);
    }

    const loop = nestedLoop.loop;
    const newFace = new Face(surface);
    Object.assign(newFace.data, originFace.data);
    newFace.outerLoop = loop;
    loop.face = newFace;
    out.push(newFace);

    for (let child of nestedLoop.nesting) {
      if (child.level == level + 2) {
        createFaces(child, surface, level + 2);
      } else if (child.level == level + 1) {
        if (!child.loop.isCCW(surface)) {
          child.loop.face = newFace;
          newFace.innerLoops.push(child.loop);
        } else {
          createFaces(child, surface, level + 1);
        }
      }
    }
  }
  const beforeLength = out.length;
  const nestedLoops = getNestedLoops(originFace, loops);
  for (let nestedLoop of nestedLoops) {
    if (nestedLoop.level == 0) {
      createFaces(nestedLoop, originSurface, 0);
    }
  }
  if (out.length > beforeLength) {
    out[beforeLength].id = originFace.id;
  }
}

function getNestedLoops(face, brepLoops) {
  function NestedLoop(loop) {
    this.loop = loop;
    this.nesting = [];
    this.level = 0;
  }

  const loops = brepLoops.map(loop => new NestedLoop(loop));
  function contains(loop, other) {
    for (let point of other.asPolygon()) {
      if (!classifyPointInsideLoop(point, loop, face.surface).inside) {
        return false;
      }
    }
    return true;
  }
  for (let i = 0; i < loops.length; ++i) {
    const loop = loops[i];
    for (let j = 0; j < loops.length; ++j) {
      if (i == j) continue;
      const other = loops[j];
      if (contains(loop.loop, other.loop)) {
        loop.nesting.push(other);
        other.level ++;
      }
    }
  }
  return loops.filter(l => l.level == 0);
}


function findMaxTurningLeft(pivotEdge, edges, normal) {
  edges = edges.slice();
  function edgeVector(edge) {
    return edge.b.point.minus(edge.a.point)._normalize();
  }
  const pivot = pivotEdge.a.point.minus(pivotEdge.b.point)._normalize();
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

function intersectFaces(shell1, shell2, inverseCrossEdgeDirection) {
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

      if (face1.data[MY].overlaps.has(face2)) {
        continue;
      }
      const curve = face1.surface.intersect(face2.surface);

      const nodes = [];
      collectNodesOfIntersectionOfFace(face2, face1, nodes);
      collectNodesOfIntersectionOfFace(face1, face2, nodes);

      const newEdges = [];
      const direction = face1.surface.normal.cross(face2.surface.normal);
      if (inverseCrossEdgeDirection) {
        direction._multiply(-1);
      }
      calculateNodeNormals(nodes, curve);
      filterNodes(nodes);
      split(nodes, newEdges, curve, direction);

      newEdges.forEach(e => {
        addNewEdge(face1, e.halfEdge1);
        addNewEdge(face2, e.halfEdge2);
      });
    }
  }
}

function addNewEdge(face, halfEdge) {
  var data = face.data[MY];
  data.newEdges.push(halfEdge);
  halfEdge.loop = data.loopOfNew;
  EdgeSolveData.createIfEmpty(halfEdge).newEdgeFlag = true;
  //addToListInMap(data.graph, halfEdge.a, halfEdge);
  return true;
}

function calculateNodeNormals(nodes, curve) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n != null) {
      n.normal = nodeNormal(n.point, n.edge, curve, n.dir);
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

function faceContainsSimilarEdge(face, halfEdge) {
  for (let loop of face.loops) {
    for (let he of loop.edges) {
      if (areEdgesEqual(halfEdge, he) || areEdgesOpposite(halfEdge, he)) {
        return true;
      }
    }
  }
  return false;
}

function collectNodesOfIntersectionOfFace(splittingFace, face, nodes) {
  for (let loop of face.loops) {
    collectNodesOfIntersection(splittingFace, loop, nodes);
  }
}

function collectNodesOfIntersection(face, loop, nodes) {
  for (let edge of loop.edges) {
    const edgeSolveData = EdgeSolveData.get(edge);
    if (edgeSolveData.skipFace.has(face)) {
      continue;
    }
    const preExistVertex = edgeSolveData.splitByFace.get(face);
    if (preExistVertex) {
      nodes.push(new Node(preExistVertex, edge, face));
      continue
    }
    intersectFaceWithEdge(face, edge, nodes);
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
    halfEdge1.a = inNode.vertex;
    halfEdge1.b = outNode.vertex;

    const halfEdge2 = new HalfEdge();
    halfEdge2.b = halfEdge1.a;
    halfEdge2.a = halfEdge1.b;

    //__DEBUG__.AddHalfEdge(halfEdge1);
    //__DEBUG__.AddSegment(new Vector(),  direction.multiply(100));


    splitEdgeByVertex(inNode.edge, halfEdge1.a, inNode.splittingFace);
    splitEdgeByVertex(outNode.edge, halfEdge1.b, outNode.splittingFace);

    const sameDirection = direction.dot(outNode.point.minus(inNode.point)) > 0;

    const edgesameDir = sameDirection ? halfEdge1 : halfEdge2;
    const halfEdgeNegativeDir = sameDirection ? halfEdge2 : halfEdge1;

    // cross edge should go with negative dir for the first face and positive for the second
    const edge = new Edge(onCurve);
    edge.halfEdge1 = halfEdgeNegativeDir;
    edge.halfEdge2 = edgesameDir;
    halfEdgeNegativeDir.edge = edge;
    edgesameDir.edge = edge;

    //check for corner case when to faces only intersects in edges
    if (!containsEdges(result, edge)) {
      result.push(edge);
    }
  }
}

function containsEdges(edges, edge) {
  for (let e of edges) {
    if (isSameEdge(e, edge)) {
      return true;
    }
  }
  return false;
}

function isSameEdge(e1, e2) {
  return areEdgesEqual(e1.halfEdge1, e2.halfEdge1);
}


function splitEdgeByVertex(originHalfEdge, vertex, splittingFace) {

  function splitHalfEdge(h) {
    const newEdge = new HalfEdge();
    newEdge.a = vertex;
    newEdge.b = h.b;
    h.b = newEdge.a;
    return newEdge;
  }

  const orig = originHalfEdge;
  const twin = orig.twin();

  if (orig.a == vertex || orig.b == vertex) {
    return;
  }

  const newOrig = splitHalfEdge(orig);
  const newTwin = splitHalfEdge(twin);


  BREPBuilder.linkedges(orig.edge, orig, newTwin);
  BREPBuilder.linkedges(new Edge(orig.edge.curve), twin, newOrig);

  orig.loop.edges.splice(orig.loop.edges.indexOf(orig) + 1, 0, newOrig);
  twin.loop.edges.splice(twin.loop.edges.indexOf(twin) + 1, 0, newTwin);

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

function intersectFaceWithEdge(face, edge, result) {

  if (DEBUG.FACE_EDGE_INTERSECTION) {
    __DEBUG__.Clear();
    __DEBUG__.AddFace(face, 0x00ffff);
    __DEBUG__.AddFace(edge.loop.face, 0xffffff);
    __DEBUG__.AddHalfEdge(edge, 0xffff00);
    DEBUG.NOOP();
  }

  const p0 = edge.a.point;
  const ab = edge.b.point.minus(p0);
  const length = ab.length();
  const v = ab._multiply(1 / length);

  if (math.areEqual(edge.edge.curve.v.dot(face.surface.normal), 0, TOLERANCE)) {
    if (math.areEqual(face.surface.normal.dot(edge.a.point), face.surface.w, TOLERANCE)) {
      classifyAndAdd(edge.a.point, true, false);
      classifyAndAdd(edge.b.point, false, true);
    }
  } else {

    let pointOfIntersection = edge.edge.curve.pointOfSurfaceIntersection(face.surface);
    let t = new Line(p0, v).t(pointOfIntersection);
    let pInsideSeg = t >= 0 && t <= length;

    const coiA = math.areVectorsEqual(edge.a.point, pointOfIntersection, TOLERANCE);
    const coiB = math.areVectorsEqual(edge.b.point, pointOfIntersection, TOLERANCE);
    if (coiA) pointOfIntersection = edge.a.point;
    if (coiB) pointOfIntersection = edge.b.point;
    if (coiA || coiB || pInsideSeg) {
      classifyAndAdd(pointOfIntersection, coiA, coiB)
    }
  }
  function classifyAndAdd(pointOfIntersection, coiA, coiB) {
    const classRes = classifyPointToFace(pointOfIntersection, face);
    if (classRes.inside) {
      let vertexOfIntersection;
      if (classRes.vertex) {
        vertexOfIntersection = classRes.vertex;
      } else if (coiA) {
        vertexOfIntersection = edge.a;
        //console.log("point A on surface");
      } else if (coiB) {
        vertexOfIntersection = edge.b;
        //console.log("point B on surface");
      } else {
        vertexOfIntersection = newVertex(pointOfIntersection);
      }

      const node = new Node(vertexOfIntersection, edge);
      
      result.push(node);
      if (classRes.edge) {
        splitEdgeByVertex(classRes.edge, vertexOfIntersection, edge.loop.face);
      }
    }
  }
}

function deleteEdge(edge) {
  if (edge.halfEdge1 != null) {
    deleteHalfEdge(edge.halfEdge1);
  }
  if (edge.halfEdge2 != null) {
    deleteHalfEdge(edge.halfEdge2);
  }
}

function deleteHalfEdge(he) {
  EdgeSolveData.createIfEmpty(he).invalid = true;
  removeFromListInMap(he.loop.face.data[MY].graph, he.a, he);
}

function classifyPointToFace(point, face) {
  function ccwCorrection(result, loop) {
    if (!loop.isCCW(face.surface)) {
      result.inside = !result.inside; 
    }
    return result;
  }

  const uvPt = face.surface.toUV(point);
  const outer = classifyPointInsideLoop(point, face.outerLoop, face.surface, uvPt);
  
  if (outer.inside) {
    if (outer.vertex || outer.edge) {
      return outer;
    }
  }
  
  for (let innerLoop of face.innerLoops) {
    const inner = classifyPointInsideLoop(point, innerLoop, face.surface, uvPt);
    if (inner.vertex || inner.edge) {
      return inner;
    }
    if (inner.inside) {
      return ccwCorrection(outer, innerLoop);
    }
  }

  return ccwCorrection(outer, face.outerLoop);
}

function nodeNormal(point, edge, curve, edgeTangent) {
  if (edgeTangent == null) {
    edgeTangent =  edgeNormal(edge); // todo @ point
  }
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
  return edge.loop.face.surface.normal.cross( edge.b.point.minus(edge.a.point) )._normalize();
}

function intersectCurveWithEdge(curve, edge, surface, result) {
  const p0 = edge.a.point;
  const ab = edge.b.point.minus(p0);
  const length = ab.length();
  const v = ab._multiply(1 / length);
  const edgeLine = new Line(p0, v);
  const t = edgeLine.intersectCurve(curve, surface);
  if (t >= 0 && t <= length) {
    const pointOfIntersection = edgeLine.parametricEquation(t);
    result.push(new Node(pointOfIntersection, edge));
  }
}

function EdgeSolveData() {
  this.splitByFace = new Map();
  this.skipFace = new Set();
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
    this.hdsFace = [];
  }
}

class FaceSolveData {
  constructor(face) {
    this.face = face;
    this.loopOfNew = new Loop();
    this.newEdges = this.loopOfNew.edges;
    this.graph = new Map();
    this.overlaps = new Set();
    this.loopOfNew.face = face;
  }
}

export function classifyPointInsideLoop( pt, loop, surface, uvPt ) {
  
  function VertexResult(vertex) {
    this.inside = true;
    this.vertex = vertex;
  }

  function EdgeResult(edge) {
    this.inside = true;
    this.edge = edge;
  }

  if (!uvPt) {
    uvPt = surface.toUV(pt);
  }
  
  function isLine(edge) {
    return !edge.edge || !edge.edge.curve || edge.edge.curve.isLine;
  }
  
  const uvCoords = new Map();
  for( let edge of loop.edges ) {
    const uv = surface.toUV(edge.a.point);
    if (math.areEqual(uvPt.y, uv.y, TOLERANCE) && math.areEqual(uvPt.x, uv.x, TOLERANCE)) {
      return new VertexResult(edge.a);
    }
    uvCoords.set(edge.a, uv);
  }

  const grads = [];
  for( let edge of loop.edges ) {
    const a = uvCoords.get(edge.a);
    const b = uvCoords.get(edge.b);
    let dy;
    if (isLine(edge)) {
      dy = b.y - a.y;
    } else {
      const tangent = edge.edge.curve.tangent(edge.a.point);
      dy = surface.toUV(tangent).y;
      if (edge.edge.invertedToCurve) {
        dy *= -1;
      }
    }
    if (math.areEqual(dy, 0, TOLERANCE)) {
      grads.push(0)
    } else if (dy > 0) {
      grads.push(1)
    } else {
      grads.push(-1)
    }
  }

  function nextGrad(start) {
    for(let i = 0; i < grads.length; ++i) {
      const idx = (i + start + 1) % grads.length; 
      if (grads[idx] != 0) {
        return grads[idx];
      }
    }    
  }

  function prevGrad(start) {
    for(let i = 0; i < grads.length; ++i) {
      const idx = (start - i - 1 + grads.length) % grads.length;
      if (grads[idx] != 0) {
        return grads[idx];
      }
    }
  }
  
  const skip = new Set();

  let ray = null;
  let inside = false;
  for( let i = 0; i < loop.edges.length; ++i) {

    const edge = loop.edges[i];

    var shouldBeSkipped = skip.has(edge.a) || skip.has(edge.b);

    const a = uvCoords.get(edge.a);
    const b = uvCoords.get(edge.b);

    const aEq = math.areEqual(uvPt.y, a.y, TOLERANCE);
    const bEq = math.areEqual(uvPt.y, b.y, TOLERANCE);

    if (aEq) {
      skip.add(edge.a);
    }  
    if (bEq) {
      skip.add(edge.b);
    }

    if (math.areVectorsEqual(a, b, TOLERANCE)) {
      console.error('unable to classify invalid polygon');
    }

    if (isLine(edge)) {
      let edgeLowPt  = a;
      let edgeHighPt = b;
  
      let edgeDx = edgeHighPt.x - edgeLowPt.x;
      let edgeDy = edgeHighPt.y - edgeLowPt.y;
  
      if (aEq && bEq) {
        if ( ( ( edgeHighPt.x <= uvPt.x ) && ( uvPt.x <= edgeLowPt.x ) ) ||
          ( ( edgeLowPt.x <= uvPt.x ) && ( uvPt.x <= edgeHighPt.x ) ) ) {
          return new EdgeResult(edge);
        } else {
          continue;
        }
      }
  
      if (shouldBeSkipped) {
        continue;
      }
  
      if ( edgeDy < 0 ) {
        edgeLowPt  = b; edgeDx = - edgeDx;
        edgeHighPt = a; edgeDy = - edgeDy;
      }
      if (!aEq && !bEq && ( uvPt.y < edgeLowPt.y || uvPt.y > edgeHighPt.y ) ) {
        continue;
      }
  
      if (bEq) {
        if (grads[i] * nextGrad(i) < 0) {
          continue;
        }
      } else if (aEq) {
        if (grads[i] * prevGrad(i) < 0) {
          continue;
        }
      }
  
      let perpEdge = edgeDx * (uvPt.y - edgeLowPt.y) - edgeDy * (uvPt.x - edgeLowPt.x);
      if ( math.areEqual(perpEdge, 0, TOLERANCE) ) return new EdgeResult(edge);		// uvPt is on contour ?
      if ( perpEdge < 0 ) {
        continue;
      }
      inside = ! inside;		// true intersection left of uvPt
      
    } else {
      
      if (aEq && bEq) {
        if (math.areEqual(edge.edge.curve.closestDistanceToPoint(pt), 0, TOLERANCE)) {
          return new EdgeResult(edge);
        } else {
          continue;
        }
      }

      if (shouldBeSkipped) {
        continue;
      }

      if (bEq) {
        if (grads[i] * nextGrad(i) < 0) {
          continue;
        }
      } else if (aEq) {
        if (grads[i] * prevGrad(i) < 0) {
          continue;
        }
      } 
      
      if (math.areEqual(edge.edge.curve.closestDistanceToPoint(pt), 0, TOLERANCE)) {
        return new EdgeResult(edge);
      }

      if (ray == null) {
        
        let rayEnd = pt.copy();
        //fixme!!
        rayEnd.x = 1000000;//surface.fromUV(surface.domainU()[1]).x;
        ray = edge.edge.curve.createLinearNurbs(pt, rayEnd);
      }
      
      const hits = edge.edge.curve.intersect(ray);
      
      for (let hit of hits) {
        //if ray just touches
        const onlyTouches = math.areEqual(edge.edge.curve.tangent(hit).normalize().y, 0, TOLERANCE);
        if (!onlyTouches) {
          inside = ! inside;    
        }
      }
    }
  }

  return	{inside};
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

