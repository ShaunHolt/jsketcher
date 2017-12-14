import {BREPValidator} from '../brep-validator';
import {Edge} from '../topo/edge';
import {Loop} from '../topo/loop';
import {edgesGenerator, Shell} from '../topo/shell';
import {Vertex} from '../topo/vertex';
import {evolveFace} from './evolve-face'
import PIP from '../../3d/tess/pip';
import * as math from '../../math/math';
import {eqEps, eqTol, eqSqTol, TOLERANCE, ueq, veq} from '../geom/tolerance';
import {Ray} from "../utils/ray";
import pickPointInside2dPolygon from "../utils/pickPointInPolygon";
import CadError from "../../utils/errors";
import {createBoundingNurbs} from "../brep-builder";

const A = 0, B = 1;

const DEBUG = {
  OPERANDS_MODE: false,
  LOOP_DETECTION: true,
  FACE_FACE_INTERSECTION: true,
  RAY_CAST: false,
  FACE_MERGE: true,
  NOOP: () => {}
};

const FILTER_STRATEGIES = {
  RAY_CAST: 'RAY_CAST',
  NEW_EDGES: 'NEW_EDGES',
};

const FILTER_STRATEGY = FILTER_STRATEGIES.NEW_EDGES; 

const TYPE = {
  UNION: 'UNION',
  INTERSECT: 'INTERSECT'
};

export function union( shell1, shell2 ) {
  $DEBUG_OPERANDS(shell1, shell2);
  return BooleanAlgorithm(shell1, shell2, TYPE.UNION);
}

export function intersect( shell1, shell2 ) {
  $DEBUG_OPERANDS(shell1, shell2);
  return BooleanAlgorithm(shell1, shell2, TYPE.INTERSECT);
}

export function subtract( shell1, shell2 ) {
  $DEBUG_OPERANDS(shell1, shell2);
  invert(shell2);
  return BooleanAlgorithm(shell1, shell2, TYPE.INTERSECT);
}

export function invert( shell ) {
  for (let face of shell.faces) {
    face.surface = face.surface.invert();
    for (let edge of shell.edges) {
      edge.invert();
    }
    for (let loop of face.loops) {
      for (let i = 0; i < loop.halfEdges.length; i++) {
        loop.halfEdges[i] = loop.halfEdges[i].twin();
      }
      loop.halfEdges.reverse();
      loop.link();
    }
  }
  shell.data.inverted = !shell.data.inverted;
  checkShellForErrors(shell, 'UNABLE_BOOLEAN_OPERAND_INVERSION');
}

function checkShellForErrors(shell, code) {
  let errors = BREPValidator.validate(shell);
  if (errors.length !== 0) {
    throw new CadError(code, errors);
  }
}

export function BooleanAlgorithm( shell1, shell2, type ) {

  shell1 = shell1.clone();
  shell2 = shell2.clone();
  
  let facesData = [];

  mergeVertices(shell1, shell2);
  initVertexFactory(shell1, shell2);

  intersectEdges(shell1, shell2);
  mergeOverlappingFaces(shell1, shell2, type);
  
  initSolveData(shell1, facesData);
  initSolveData(shell2, facesData);

  intersectFaces(shell1, shell2, type);
  
  for (let faceData of facesData) {
    faceData.initGraph();
  }
  checkFaceDataForError(facesData);
  
  for (let faceData of facesData) {
    faceData.detectedLoops = detectLoops(faceData.face.surface, faceData);
  }
  
  let detectedLoops = new Set();
  for (let faceData of facesData) {
    for (let loop of faceData.detectedLoops) {
      detectedLoops.add(loop);
    }
  }

  // let invalidLoops = invalidateLoops(detectedLoops);
  
  let faces = [];
  
  for (let faceData of facesData) {
    // faceData.detectedLoops = faceData.detectedLoops.filter(l => !invalidLoops.has(l));
    loopsToFaces(faceData.face, faceData.detectedLoops, faces);
  }

  faces = filterFaces(faces, shell1, shell2, type !== TYPE.UNION);
  
  
  const result = new Shell();
  faces.forEach(face => {
    face.shell = result;
    result.faces.push(face);
  });

  cleanUpSolveData(result);
  BREPValidator.validateToConsole(result);

  // __DEBUG__.ClearVolumes();
  // __DEBUG__.Clear();
  return result;
}

function detectLoops(surface, graph) {
  if (DEBUG.LOOP_DETECTION) {
    __DEBUG__.Clear();
    graph.graphEdges.forEach(de => __DEBUG__.AddHalfEdge(de, 0x00ff00));
    DEBUG.NOOP();
  }

  const loops = [];
  const seen = new Set();
  while (true) {
    let edge = graph.graphEdges.pop();
    if (!edge) {
      break;
    }
    if (seen.has(edge)) {
      continue;
    }
    const loop = new Loop(null);
    
    while (edge) {
      if (DEBUG.LOOP_DETECTION) {
        __DEBUG__.AddHalfEdge(edge);
      }
      seen.add(edge);
      loop.halfEdges.push(edge);
      if (loop.halfEdges[0].vertexA === edge.vertexB) {
        loop.link();
        loops.push(loop);
        break;
      }
      
      let candidates = graph.vertexToEdge.get(edge.vertexB);
      if (!candidates) {
        break;
      }
      candidates = candidates.filter(c => c.vertexB !== edge.vertexA || !isSameEdge(c, edge));
      edge = findMaxTurningLeft(edge, candidates, surface);
      if (seen.has(edge)) {
        break;
      }
    }
  }
  return loops;
}


function findOverlappingFaces(shell1, shell2) {

  function overlapsImpl(face1, face2) {
    function pointOnFace(face, pt) {
      return face.env2D().pip(face.surface.workingPoint(pt)).inside;
    }
    for (let e1 of face1.edges) {
      if (pointOnFace(face2, e1.vertexA.point)) {
        return true;    
      }
    }
  }

  function overlaps(face1, face2) {
    let ss1 = face1.surface.simpleSurface; 
    let ss2 = face2.surface.simpleSurface; 
    if (ss1 !== null && ss2 !== null && ss1.TYPE === 'plane' && ss1.TYPE === ss2.TYPE && 
        ss1.coplanarUnsigned(ss2)) {
      return overlapsImpl(face1, face2) || overlapsImpl(face2, face1);        
    }
    return false;  
  }

  let overlapGroups = [];

  for (let face1 of shell1.faces) {
    for (let face2 of shell2.faces) {
      if (DEBUG.FACE_MERGE) {
        __DEBUG__.Clear();
        __DEBUG__.AddFace(face1, 0x0000ff);
        __DEBUG__.AddFace(face2);
      }
      if (overlaps(face1, face2) ) {
        let group = overlapGroups.find(g => g[0].has(face1) || g[1].has(face2));
        if (!group) {
          group = [new Set(), new Set()];    
          overlapGroups.push(group);
        } 
        group[0].add(face1);
        group[1].add(face2);
      }
    }
  }
  return overlapGroups;
}

function mergeOverlappingFaces(shell1, shell2, opType) {
  let groups = findOverlappingFaces(shell1, shell2);
  for (let group of groups) {
    mergeFaces(Array.from(group[0]), Array.from(group[1]), opType)
  }
}

function mergeFaces(faces1, faces2, opType) {

  let allFaces = [...faces1, ...faces2];
  for (let face of allFaces) {
    face.__mergeGraph = new Map();
    for (let e of face.edges) {
      addToListInMap(face.__mergeGraph, e.vertexA, e);
    }
  }

  let destFace = faces1[0];

  let valid = new Set();
  let invalid = new Set();

  function invalidate(face, edgesIndex) {
    for (let loop of face.loops) {
      for (let [inEdge, outEdge, v] of loop.encloses) {
        if (DEBUG.FACE_MERGE) {
          __DEBUG__.Clear();
          __DEBUG__.AddFace(face);
          __DEBUG__.AddHalfEdge(inEdge, 0x0000ff);
          __DEBUG__.AddHalfEdge(outEdge, 0xffff00);
        }
        let edgesToTest = edgesIndex.get(v);
        if (!edgesToTest) {
          continue;
        }
        for (let testee of edgesToTest) {
          if (DEBUG.FACE_MERGE) {
            __DEBUG__.AddHalfEdge(testee, 0xffffff);
          }

          if (isSameEdge(testee, outEdge)) {
            // support coming soon;
            throw new CadError('BOOLEAN_INVALID_RESULT', edgeCollisionError(testee, outEdge));
          } else if (isSameEdge(testee, inEdge)) {
            //annigilation here
            throw new CadError('BOOLEAN_INVALID_RESULT', edgeCollisionError(testee, inEdge));
          } else {
            
            let inside = isInsideEnclose(destFace.surface.normal(v.point), 
              testee.tangentAtStart(), inEdge.tangentAtEnd(), outEdge.tangentAtStart());

            if (inside && opType === TYPE.INTERSECT) {
              valid.add(testee);
            } else if (!inside && opType === TYPE.INTERSECT) {
              invalid.add(testee);
            } else if (inside && opType === TYPE.UNION) {
              invalid.add(testee);
            } else if (!inside && opType === TYPE.UNION) {
              valid.add(testee);
            } else {
              throw 'invariant';
            }
          }
        }
      }
    }
  }

  for (let face1 of faces1) {
    for (let face2 of faces2) {
      invalidate(face1, face2.__mergeGraph);
      invalidate(face2, face1.__mergeGraph);
    }
  }

  for (let face of allFaces) {
    for (let loop of face.loops) {
      loop.link();          
    }
  }

  for (let edge of valid) {
    EdgeSolveData.markNew(edge);
  }

  for (let edge of invalid) {
    edge = edge.next;
    while (!valid.has(edge) && !invalid.has(edge)) {
      invalid.add(edge);
      edge = edge.next;
    }
  }

  let graph = new EdgeGraph();
  let discardedEdges = new Set();
  for (let face of allFaces) {
    for (let edge of face.edges) {
      discardedEdges.add(edge);
      if (!invalid.has(edge)) {
        graph.add(edge);
      }
    }
  }
  
  for (let face of allFaces) {
    if (destFace !== face) {
      face.data[MY] = INVALID_FLAG;
    }
    face.outerLoop.halfEdges = [];
    face.innerLoops = [];
  }    

  destFace.innerLoops = detectLoops(destFace.surface, graph);
  let allPoints = [];
  for (let edge of destFace.edges) {
    discardedEdges.delete(edge);
    allPoints.push(edge.vertexA.point);
  }
  if (allPoints.length === null) {
    destFace.data[MY] = INVALID_FLAG;
    return;
  }
  destFace.surface = createBoundingNurbs(allPoints, destFace.surface.simpleSurface);
  
  for (let loop of destFace.loops) {
    loop.face = destFace;
  }
  destFace.data[MY] = {discardedEdges};
}

export function mergeVertices(shell1, shell2) {
  const toSwap = new Map();
  for (let v1 of shell1.vertices) {
    for (let v2 of shell2.vertices) {
      if (veq(v1.point, v2.point)) {
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

function isPointInsideSolid(pt, normal, solid) {
  let ray = new Ray(pt, normal, normal, 3000);
  for (let i = 0; i < 1; ++i) {
    let res = rayCastSolidImpl(ray, solid);
    if (res !== null) {
      return res;    
    }
    ray.pertrub();
  }
  return false; 
}

function rayCastSolidImpl(ray, solid) {
  if (DEBUG.RAY_CAST) {
    __DEBUG__.AddCurve(ray.curve, 0xffffff);  
  }
  let closestDistanceSq = -1;
  let inside = null;
  let hitEdge = false;

  let edgeDistancesSq = [];
  for (let e of solid.edges) {
    let points = e.curve.intersectCurve(ray.curve, TOLERANCE);
    for (let {p0} of points) {
      edgeDistancesSq.push(ray.pt.distanceToSquared(p0));
    }  
  }

  for (let face of solid.faces) {
    if (DEBUG.RAY_CAST) {
      __DEBUG__.AddFace(face, 0xffff00);
    }
    let pip = face.data[MY].env2D().pip;
    function isPointinsideFace(uv, pt) {
      let wpt = face.surface.createWorkingPoint(uv, pt); 
      let pipClass = pip(wpt);
      return pipClass.inside;
    }

    let originUv = face.surface.param(ray.pt);
    let originPt = face.surface.point(originUv[0], originUv[1]);
    if (eqSqTol(0, originPt.distanceToSquared(ray.pt)) && isPointinsideFace(originUv, originPt)) {
      let normal = face.surface.normalUV(originUv[0], originUv[1]);
      return normal.dot(ray.normal) > 0;
    } else {
      let uvs = face.surface.intersectWithCurve(ray.curve);     
      for (let uv of uvs) {
        let normal = face.surface.normalUV(uv[0], uv[1]);
        let dotPr = normal.dot(ray.dir);
        if (eqTol(dotPr, 0)) {
          continue;
        }
        let pt = face.surface.point(uv[0], uv[1]);
        if (isPointinsideFace(uv, pt)) {
          let distSq = ray.pt.distanceToSquared(pt);
           if (closestDistanceSq === -1 || distSq < closestDistanceSq) {
            hitEdge = false; 
            for (let edgeDistSq of edgeDistancesSq) {
              if (eqSqTol(edgeDistSq, distSq)) {
                hitEdge = true;
              }    
            }
            closestDistanceSq = distSq;
            inside = dotPr > 0;
          }
        }
      } 
    }
  }

  if (hitEdge) {
    return null;
  }

  if (inside === null) {
    inside = !!solid.data.inverted
  }
  return inside;
}

function pickPointOnFace(face) {
  let wp = pickPointInside2dPolygon(face.createWorkingPolygon());
  if (wp === null) {
    return null;
  }
  return face.surface.workingPointTo3D(wp);
}

function filterByRayCast(faces, a, b, isIntersection) {
  
  let result = [];
  for (let face of faces) {
    if (DEBUG.RAY_CAST) {
      __DEBUG__.Clear();
      __DEBUG__.AddFace(face, 0x00ff00);
    }

    let pt = pickPointOnFace(face);
    if (pt === null) {
      continue;
    }
    
    let normal = face.surface.normal(pt);

    let insideA = face.data.__origin.shell === a || isPointInsideSolid(pt, normal, a);
    let insideB = face.data.__origin.shell === b || isPointInsideSolid(pt, normal, b);
    if (isIntersection) {
      if (insideA && insideB) {
        result.push(face);
      }
    } else {
      if (insideA || insideB) {
        result.push(face);
      }
    }
  }
  return result;
}

function filterFaces(faces, a, b, isIntersection) {

  if (FILTER_STRATEGY === FILTER_STRATEGIES.RAY_CAST) {
    return filterByRayCast(faces, a, b, isIntersection);
  } else if (FILTER_STRATEGY === FILTER_STRATEGIES.NEW_EDGES) {
    return filterFacesByNewEdges(faces, a, b, isIntersection);
  } else {
    throw 'unsupported';
  }
}

function filterFacesByNewEdges(faces) {

  function isFaceContainNewEdge(face) {
    for (let e of face.edges) {
      if (isNewNM(e)) {
        return true;
      }
    }
    return false;
  }
  
  const validFaces = new Set(faces);
  const result = new Set();
  for (let face of faces) {
    // __DEBUG__.Clear();
    // __DEBUG__.AddFace(face);
    traverseFaces(face, validFaces, (it) => {
      if (result.has(it) || isFaceContainNewEdge(it)) {
        result.add(face);
        return true;
      }
    });
  }
  return result;
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
    if (!validFaces.has(face)) continue;
    for (let loop of face.loops) {
      for (let halfEdge of loop.halfEdges) {
        for (let twin of halfEdge.twins()) {
          if (validFaces.has(twin.loop.face)) {
            stack.push(twin.loop.face)
          }
        }
      }
    }
  }
}

function invalidateLoops(newLoops) {
  // __DEBUG__.Clear();
  const invalid = new Set();
  for (let loop of newLoops) {
    // __DEBUG__.AddLoop(loop);
    for (let e of loop.halfEdges) {
      if (e.manifold !== null) {
        let manifold = [e,  ...e.manifold];
        manifold.filter(me => newLoops.has(me.twin().loop));
        if (manifold.length === 0) {
          invalid.add(loop);
        } else {
          let [me, ...rest] = manifold;
          e.edge = me.edge;
          e.manifold = rest.length === 0 ? null : rest;
        }
      } else {
        if (!newLoops.has(e.twin().loop)) {
          invalid.add(loop);
          break;
        }
      }
    }
  }
  
  // const seen = new Set();
  //
  // const stack = Array.from(invalid);
  //
  // while (stack.length !== 0) {
  //   let loop = stack.pop();
  //   if (!seen.has(loop)) continue;
  //   seen.add(loop);
  //    
  //   for (let he of loop.halfEdges) {
  //     let twins = he.twins();
  //     for (let twin of twins) {
  //       invalid.add(twin.loop);
  //       stack.push(twin.loop); 
  //     }        
  //   }
  // }
  return invalid;  
}

export function loopsToFaces(originFace, loops, out) {
  const newFaces = evolveFace(originFace, loops);
  for (let newFace of newFaces) {
    out.push(newFace);
  }
}

function initSolveData(shell, facesData) {
  for (let face of shell.faces) {
    if (face.data[MY] === INVALID_FLAG) {
      continue;
    }
    const solveData = new FaceSolveData(face);
    facesData.push(solveData);
    if (face.data[MY] !== undefined) {
      Object.assign(solveData, face.data[MY]);
    }
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

function findMaxTurningLeft(pivotEdge, edges, surface) {
  edges = edges.slice();
  function edgeVector(edge) {
    return edge.tangent(edge.vertexA.point);
  }
  const pivot = pivotEdge.tangent(pivotEdge.vertexB.point).negate();
  const normal = surface.normal(pivotEdge.vertexB.point);
  edges.sort((e1, e2) => {
    let delta = leftTurningMeasure(pivot, edgeVector(e1), normal) - leftTurningMeasure(pivot, edgeVector(e2), normal);
    if (ueq(delta, 0)) {
      return isNew(e1) ? (isNew(e2) ? 0 : -1) : (isNew(e2) ? 1 : 0) 
    }
    return delta;
  });
  return edges[0];
}

function leftTurningMeasure(v1, v2, normal) {
  let measure = v1.dot(v2);
  if (ueq(measure, 1)) {
    return 0;    
  }
  measure += 3; //-1..1 => 2..4
  if (v1.cross(v2).dot(normal) < 0) {
    measure = 4 - measure;
  }
  //make it positive all the way
  return measure;
}

function intersectEdges(shell1, shell2) {
  let isecs = new Map();
  function addIsesc(e, params) {
    let allParams = isecs.get(e);
    if (!allParams) {
      isecs.set(e, params);
    } else {
      params.forEach(p => allParams.push(p));
    }
  }
  for (let e1 of shell1.edges) {
    for (let e2 of shell2.edges) {
      let points = e1.curve.intersectCurve(e2.curve, TOLERANCE);
      if (points.length !== 0) {
        const vertexHolder = [];
        addIsesc(e1, points.map(p => ({u: p.u0, vertexHolder})));
        addIsesc(e2, points.map(p => ({u: p.u1, vertexHolder})));
      }
    }
  }
  for (let [e, points] of isecs) {
    points.sort((p1, p2) => p1.u - p2.u);
    let first = points[0];
    let last = points[points.length - 1];
    if (ueq(first.u, 0)) {
      // if (!first.vertexHolder[0]) {
      //   first.vertexHolder[0] = e.halfEdge1.vertexA;
      // }
      first.skip = true;
    }
    if (ueq(last.u, 1)) {
      // if (!last.vertexHolder[0]) {
      //   last.vertexHolder[0] = e.halfEdge1.vertexB;
      // }
      last.skip = true;
    }
  }
  for (let [e, points] of isecs) {
    for (let {u, vertexHolder} of points ) {
      if (!vertexHolder[0]) {
        vertexHolder[0] = vertexFactory.create(e.curve.point(u));
      }
    }
  }
  for (let [e, points] of isecs) {
    for (let {u, vertexHolder, skip} of points ) {
      if (skip === true) {
        continue;
      }
      let split = splitEdgeByVertex(e, vertexFactory.create(e.curve.point(u)));
      if (split !== null) {
        e = split[1];
      }
    }
  }
}


function fixCurveDirection(curve, surface1, surface2, operationType) {
  let point = curve.point(0.5);
  let tangent = curve.tangentAtPoint(point);
  let normal1 = surface1.normal(point);
  let normal2 = surface2.normal(point);

  let expectedDirection = normal1.cross(normal2);

  if (operationType === TYPE.UNION) {
    expectedDirection._negate();
  }
  let sameAsExpected = expectedDirection.dot(tangent) > 0;
  if (!sameAsExpected) {
    curve = curve.invert();
  }
  return curve;
}

//TODO: extract to a unit test
function newEdgeDirectionValidityTest(e, curve) {
  let point = e.halfEdge1.vertexA.point;
  let tangent = curve.tangentAtPoint(point);
  assert('tangent of originated curve and first halfEdge should be the same', math.vectorsEqual(tangent, e.halfEdge1.tangent(point)));
  assert('tangent of originated curve and second halfEdge should be the opposite', math.vectorsEqual(tangent._negate(), e.halfEdge2.tangent(point)));
}

function intersectFaces(shell1, shell2, operationType) {
  const invert = operationType === TYPE.UNION;
  for (let i = 0; i < shell1.faces.length; i++) {
    const face1 = shell1.faces[i];
    if (DEBUG.FACE_FACE_INTERSECTION) {
      __DEBUG__.Clear();
      __DEBUG__.AddFace(face1, 0x00ff00);
      DEBUG.NOOP();
    }
    for (let j = 0; j < shell2.faces.length; j++) {
      const face2 = shell2.faces[j];
      if (DEBUG.FACE_FACE_INTERSECTION) {
        __DEBUG__.Clear();
        __DEBUG__.AddFace(face1, 0x00ff00);
        __DEBUG__.AddFace(face2, 0x0000ff);
        if (face1.refId === 0 && face2.refId === 0) {
          DEBUG.NOOP();
        }
      }

      let curves = face1.surface.intersectSurface(face2.surface);

      for (let curve of curves) {
        if (DEBUG.FACE_FACE_INTERSECTION) {
          __DEBUG__.AddCurve(curve);
        }
        
        curve = fixCurveDirection(curve, face1.surface, face2.surface, operationType);
        const nodes = [];
        collectNodesOfIntersectionOfFace(curve, face1, nodes, A);
        collectNodesOfIntersectionOfFace(curve, face2, nodes, B);

        const newEdges = [];
        split(nodes, curve, newEdges);

        newEdges.forEach(e => {
          newEdgeDirectionValidityTest(e, curve);
          addNewEdge(face1, e.halfEdge1);
          addNewEdge(face2, e.halfEdge2);
        });
      }
    }
  }
}

function addNewEdge(face, halfEdge) {
  const data = face.data[MY];
  data.loopOfNew.halfEdges.push(halfEdge);
  halfEdge.loop = data.loopOfNew;
  EdgeSolveData.markNew(halfEdge);
  return true;
}

function nodeByVertex(nodes, vertex, u, curve) {
  let node = nodes.find(n => n.vertex === vertex);
  if (!node) {
    if (u === undefined) {
      u = curve.param(vertex.point);
    }
    node = new Node(vertex, u);
    nodes.push(node);
  }
  return node;
}

function collectNodesOfIntersectionOfFace(curve, face, nodes, operand) {
  for (let loop of face.loops) {
    collectNodesOfIntersection(curve, loop, nodes, operand);
  }
}

function collectNodesOfIntersection(curve, loop, nodes, operand) {
  for (let [a, b, v] of loop.encloses) {
    if (curve.passesThrough(v.point)) {
      let node = nodeByVertex(nodes, v, undefined, curve);
      if (curveAndEdgeCoincident(curve, b)) {
        node.leaves[operand] = true;
      } else {
        if (isCurveEntersEnclose(curve, a, b)) {
          node.enters[operand] = true;
        } else {
          node.leaves[operand] = true;
        }
      }
    }
  }    
  for (let edge of loop.halfEdges) {
    intersectCurveWithEdge(curve, edge, nodes, operand);
  }
}

function intersectCurveWithEdge(curve, edge, nodes, operand) {
  // __DEBUG__.AddCurve(curve, 0xffffff);
  // __DEBUG__.AddHalfEdge(edge, 0xff00ff);
  const points = edge.edge.curve.intersectCurve(curve);
  for (let point of points) {
    const {u0, u1} = point;
    let vertex = vertexFactory.create(point.p0, () => null);
    if (vertex === null) {
      //vertex already exists, means we hit an end of edge and this case is handled by enclosure analysis
      continue;
    }
      
    let node = nodeByVertex(nodes, vertex, u1);
    if (isCurveEntersEdgeAtPoint(curve, edge, vertex.point)) {
      node.enters[operand] = true;
    } else {
      node.leaves[operand] = true;
    }
    node.edgeSplitInfo = {edge, u: u0};
    // __DEBUG__.AddVertex(vertex);
  }
}

function split(nodes, curve, result) {
  nodes.sort((n1, n2) => n1.u - n2.u);

  let insideA = false;
  let insideB = false;
  let inNode = null;
  let edgesToSplits = [];
  function checkNodeForEdgeSplit(node) {
    if (inNode.edgeSplitInfo !== null) {
      addToListInMap(edgesToSplits, node.edgeSplitInfo.edge.edge, node);
    }
  }
  
  for (let node of nodes) {
    let wasInside = insideA && insideB;
    let hadLeft = false; 
    if (node.enters[A] === true) {
      insideA = true;
      inNode = node;
    }
    if (node.leaves[A] === true) {
      insideA = false;
      hadLeft = true;
    }
    if (node.enters[B] === true) {
      insideB = true;
      inNode = node;
    }
    if (node.leaves[B] === true) {
      insideB = false;
      hadLeft = true;
    }
    
    if (wasInside && hadLeft) {
      let edgeCurve = curve;
      if (!ueq(inNode.u, 0)) {
        [,edgeCurve] = edgeCurve.split(inNode.vertex.point);
      }
      if (!ueq(node.u, 1)) {
        [edgeCurve] = edgeCurve.split(node.vertex.point);
      }
      const edge = new Edge(edgeCurve, inNode.vertex, node.vertex);
      result.push(edge);
      checkNodeForEdgeSplit(inNode);
      checkNodeForEdgeSplit(node);
    }
  }
  
  for (let [edge, nodes] of edgesToSplits) {
    nodes.sort(({edgeSplitInfo:{u}}) => u);
    for (let {vertex} of nodes) {
      [,edge] = splitEdgeByVertex(edge, vertex);
    }
  }
}

function splitEdgeByVertex(edge, vertex) {

  if (edge.halfEdge1.vertexA === vertex || edge.halfEdge1.vertexB === vertex) {
    return null;
  }

  const curves = edge.curve.split(vertex.point);
  const edge1 = new Edge(curves[0], edge.halfEdge1.vertexA, vertex);
  const edge2 = new Edge(curves[1], vertex, edge.halfEdge1.vertexB);

  function updateInLoop(halfEdge, h1, h2) {
    let halfEdges = halfEdge.loop.halfEdges;
    halfEdges.splice(halfEdges.indexOf(halfEdge), 1, h1, h2);
    h1.loop = halfEdge.loop;
    h2.loop = halfEdge.loop;
  }
  updateInLoop(edge.halfEdge1, edge1.halfEdge1, edge2.halfEdge1);
  updateInLoop(edge.halfEdge2, edge2.halfEdge2, edge1.halfEdge2);

  EdgeSolveData.transfer(edge.halfEdge1, edge1.halfEdge1);
  EdgeSolveData.transfer(edge.halfEdge1, edge2.halfEdge1);

  EdgeSolveData.transfer(edge.halfEdge2, edge2.halfEdge2);
  EdgeSolveData.transfer(edge.halfEdge2, edge1.halfEdge2);

  return [edge1, edge2];
}

function isOnPositiveHalfPlaneFromVec(vec, testee, normal) {
  return vec.cross(testee).dot(normal) > 0;
}

function isInsideEnclose(normal, testee, inVec, outVec){
  let insideOfOut = isOnPositiveHalfPlaneFromVec(outVec, testee, normal);
  let insideOfIn = isOnPositiveHalfPlaneFromVec(inVec, testee, normal);
  let inside = insideOfOut && insideOfIn;
  return inside;
}

function isCurveEntersEnclose(curve, a, b) {
  let pt = a.vertexB.point;
  let normal = a.loop.face.surface.normal(pt);
  return isInsideEnclose(normal, curve.tangentAtPoint(pt), a.tangentAtEnd(), b.tangentAtStart()); 
}

function isCurveEntersEdgeAtPoint(curve, edge, point) {
  
  const normal = edge.loop.face.surface.normal(point);
  const edgeTangent = edge.tangent(point);
  const curveTangent = curve.tangentAtPoint(point);

  return isOnPositiveHalfPlaneFromVec(edgeTangent, curveTangent, normal);
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

EdgeSolveData.markNew = function(halfEdge) {
  EdgeSolveData.createIfEmpty(halfEdge).newEdgeFlag = true;
};

function isNew(edge) {
  return EdgeSolveData.get(edge).newEdgeFlag === true
}

function isNewNM(edge) {
  if (edge.manifold === null) {
    return isNew(edge);
  }
  for (let me of edge.manifold) {
    if (isNew(me)) {
      return true;
    }
  }
  return isNew(edge); 
}

function Node(vertex, u) {
  this.u = u;
  this.vertex = vertex;
  this.enters = [false, false];
  this.leaves = [false, false];
  this.edgeSplitInfo = null;
}


let vertexFactory = null;
function initVertexFactory(shell1, shell2) {
  vertexFactory = new VertexFactory();
  vertexFactory.addVertices(shell1.vertices);
  vertexFactory.addVertices(shell2.vertices);
}

class VertexFactory {

  constructor() {
    this.vertices = [];
  }

  addVertices(vertices) {
    for (let v of vertices) {
      this.vertices.push(v);
    }
  }

  find(point) {
    for (let vertex of this.vertices) {
      if (veq(point, vertex.point)) {
        return vertex;
      }
    }
    return null;
  }

  create(point, onExistent) {
    let vertex = this.find(point);
    if (vertex === null) {
      vertex = new Vertex(point);
      this.vertices.push(vertex);
    } else if (onExistent !== undefined) {
      return onExistent(vertex);
    }
    return vertex;
  }
}

class SolveData {
  constructor() {
    this.faceData = [];
  }
}

class EdgeGraph {
  constructor() {
    this.vertexToEdge = new Map();
    this.graphEdges = [];
  }
 
  add(he) {
    addToListInMap(this.vertexToEdge, he.vertexA, he);
    this.graphEdges.push(he);
  }
}

class FaceSolveData extends EdgeGraph {
  constructor(face) {
    super();
    this.face = face;
    this.loopOfNew = new Loop(face);
    face.innerLoops.push(this.loopOfNew);
    this.errors = [];
  }

  initGraph() {
    this.vertexToEdge.clear();
    for (let he of this.face.edges) {
      this.addToGraph(he);
    }
  }

  addToGraph(he) {
    // __DEBUG__.Clear();
    // __DEBUG__.AddFace(he.loop.face);
    // __DEBUG__.AddHalfEdge(he, 0xffffff);
    // if (this.isNewOppositeEdge(he)) {
    //   return;
    // }
    let opp = this.findOppositeEdge(he);
    if (opp) {
      this.errors.push(edgeCollisionError(opp, he));
    }
    
    let list = this.vertexToEdge.get(he.vertexA);
    if (!list) {
      list = [];
      this.vertexToEdge.set(he.vertexA, list);
    } else {
      for (let ex of list) {
        if (he.vertexB === ex.vertexB && isSameEdge(he, ex)) {
          this.errors.push(edgeCollisionError(ex, he));
        //   ex.attachManifold(he);    
        //   return; 
        }          
      }
    }
    list.push(he);
    this.graphEdges.push(he);
  }

  findOppositeEdge(e1) {
    let others = this.vertexToEdge.get(e1.vertexB);
    if (others) {
      for (let e2 of others) {
        if (e1.vertexA === e2.vertexB && isSameEdge(e1, e2)) {
          return e2;
        }
      }
    }
    return null;
  }


  isNewOppositeEdge(e1) {
    if (!isNew(e1)) {
      return false;
    }
    return this.findOppositeEdge(e1) !== null;
  }
  
  removeOppositeEdges() {
    let toRemove = new Set();
    for (let e1 of this.graphEdges) {
    }
    for (let e of toRemove) {
      removeFromListInMap(this.vertexToEdge, e.vertexA, e);
    }
    this.graphEdges = this.graphEdges.filter(e => !toRemove.has(e));
  }
}

function removeFromListInMap(map, key, value) {
  let list = map.get(key);
  if (list) {
    const idx = list.indexOf(value);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  }
}

function edgesHaveSameEnds(e1, e2) {
  let a1 = e1.vertexA;
  let b1 = e1.vertexB;
  let a2 = e2.vertexA;
  let b2 = e2.vertexB;
  return (a1 === a2 && b1 === b2) || (a1 === b2 && b1 === a2) 
}

function isSameEdge(e1, e2) {
  let tess = e1.tessellate();
  for (let pt1 of tess) {
    let pt2 = e2.edge.curve.point(e2.edge.curve.param(pt1));
    if (!veq(pt1, pt2)) {
      return false;
    }
  }
  return true;
}

function curveAndEdgeCoincident(curve, edge) {
  let tess = edge.tessellate();
  //Do reverese to optimaze a bit because the first point is usually checked
  for (let i = tess.length - 1; i >= 0; i--) {
    let pt1 = tess[i];
    let pt2 = curve.point(curve.param(pt1));
    if (!veq(pt1, pt2)) {
      return false;
    }
  }
  return true;
}

function edgeCollisionError(e1, e2) {
  return {
    e1, e2, code: 'EDGE_COLLISION'
  }
}

function checkFaceDataForError(facesData) {
  if (facesData.find(f => f.errors.length !== 0)) {
    let payload = [];    
    for (let faceData of facesData) {
      for (let err of faceData.errors) {
        payload.push(err);
      }
    }
    throw new CadError('BOOLEAN_INVALID_RESULT', payload);
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

function $DEBUG_OPERANDS(shell1, shell2) {
  if (DEBUG.OPERANDS_MODE) {
    __DEBUG__.HideSolids();
    __DEBUG__.AddVolume(shell1, 0x800080);
    __DEBUG__.AddVolume(shell2, 0xfff44f);
  }
}

const eq = eqTol;

function assert(name, cond) {
  if (!cond) {
    throw 'ASSERTION FAILED: ' + name;
  }
}

const INVALID_FLAG = 'INVALID_FLAG'; 
const MY = '__BOOLEAN_ALGORITHM_DATA__'; 
