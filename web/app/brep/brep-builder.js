import {Shell} from './topo/shell'
import {Vertex} from './topo/vertex'
import {Loop} from './topo/loop'
import {Face} from './topo/face'
import {HalfEdge, Edge} from './topo/edge'
import {Line} from './geom/impl/line'
import {ApproxCurve, ApproxSurface} from './geom/impl/approx'
import {Plane} from './geom/impl/plane'
import {Point} from './geom/point'
import {BasisForPlane, Matrix3} from '../math/l3space'
import * as cad_utils from '../3d/cad-utils'
import * as math from '../math/math'
import {Segment, Contour} from '../3d/craft/sketch/sketch-model'

function isCCW(points, normal) {
  const tr2d = new Matrix3().setBasis(BasisForPlane(normal)).invert();
  const points2d = points.map(p => tr2d.apply(p));
  return math.isCCW(points2d);
}

function checkCCW(points, normal) {
  if (!isCCW(points, normal)) {
    points = points.slice();
    points.reverse();
  }
  return points;
}

export function createPrism(basePoints, height) {
  const normal = cad_utils.normalOfCCWSeq(basePoints);
  const baseSurface = new Plane(normal, normal.dot(basePoints[0]));
  const contour = new Contour();
  iterateSegments(basePoints, (a, b) => contour.segments.push(new Segment(null, a, b)));
  return new SimpleExtruder(height).extrude(contour, baseSurface);
}

export class Extruder {

  getLidSurface(baseSurface) {
    throw 'not implemented';
  }

  getLidPointTransformation() {
    throw 'not implemented';
  }

  extrude(contour, baseSurface, reverse) {

    if (reverse) contour.reverse(); 
    const baseLoop = createLoopFromTrimmedCurve(contour.transferOnSurface(baseSurface));
    if (reverse) contour.reverse();
    if (reverse) baseSurface = baseSurface.invert();
    const baseFace = createFace(baseSurface, baseLoop);
    const lidSurface = this.getLidSurface(baseSurface);
    
    contour.reverse();
    const lidLoop = createLoopFromTrimmedCurve(contour.transferOnSurface(baseSurface, null, this.getLidPointTransformation()));
    contour.reverse();
    
    const shell = new Shell();
  
    const n = baseLoop.halfEdges.length;
    for (let i = 0; i < n; i++) {
      let lidIdx = n - 1 - i;
      const baseHalfEdge = baseLoop.halfEdges[i];
      const lidHalfEdge = lidLoop.halfEdges[lidIdx];
      const wallFace = createFaceFromTwoEdges(baseHalfEdge.createTwin(), lidHalfEdge.createTwin());
      wallFace.role = 'wall:' + i;
      this.onWallCallback(wallFace, baseHalfEdge);
      shell.faces.push(wallFace);
      linkSegments(wallFace.outerLoop.halfEdges);
    }
    iterateSegments(shell.faces, (a, b) => {
      const halfEdgeA = a.outerLoop.halfEdges[3];
      const halfEdgeB = b.outerLoop.halfEdges[1];
      linkHalfEdges(new Edge(Line.fromSegment(halfEdgeA.vertexA.point,  halfEdgeA.vertexB.point)), halfEdgeA, halfEdgeB);
    });
    
    const lidFace = createFace(lidSurface, lidLoop);
    baseFace.role = 'base';
    lidFace.role = 'lid';
    
    shell.faces.push(baseFace, lidFace);
    shell.faces.forEach(f => f.shell = shell);
    return shell;
  }

  onWallCallback(wallFace, baseHalfEdge) {
  }
}

export class SimpleExtruder extends Extruder {
  
  constructor(height) {
    super();
    this.height = height;
  }

  getLidSurface(baseSurface) {
    this.extrudeVector = baseSurface.normal.multiply( - this.height);
    return baseSurface.move(this.extrudeVector).invert();
  }

  getLidPointTransformation() {
    return (p) => p.plus(this.extrudeVector);
  }
}

function createFace(surface, loop) {
  const face = new Face(surface);
  face.outerLoop = loop;
  loop.face = face;
  return face;
}


function createPlaneForLoop(normal, loop) {
  const w = loop.halfEdges[0].vertexA.point.dot(normal);
  const plane = new Plane(normal, w);
  return plane;
}

function createPlaneFace(normal, loop) {
  const plane = createPlaneForLoop();
  const face = new Face(plane);
  face.outerLoop = loop;
  loop.face = face;
  return face;
}


export function linkHalfEdges(edge, halfEdge1, halfEdge2) {
  halfEdge1.edge = edge;
  halfEdge2.edge = edge;
  edge.halfEdge1 = halfEdge1;
  edge.halfEdge2 = halfEdge2;
}

export function createLoopFromTrimmedCurve(segments) {
  const loop = new Loop();
  const vertices = segments.map(s => new Vertex(s.a));
  for (let i = 0; i < segments.length; ++i) {
    let seg = segments[i];
    const halfEdge = createHalfEdge(loop, vertices[i], vertices[(i + 1) % vertices.length]);
    halfEdge.edge = new Edge(seg.curve);
    halfEdge.edge.halfEdge1 = halfEdge; 
  }
  linkSegments(loop.halfEdges);
  return loop;
}

export function createHalfEdge(loop, vertexA, vertexB) {
  const halfEdge = new HalfEdge();
  halfEdge.loop = loop;
  halfEdge.vertexA = vertexA;
  halfEdge.vertexB = vertexB;
  loop.halfEdges.push(halfEdge);
  return halfEdge;
}

export function linkSegments(halfEdges) {
  iterateSegments(halfEdges, (prev, next) => {
    prev.next = next;
    next.prev = prev;
  });
}

export function point(x, y, z) {
  return new Point(x, y, z);
}

export function iterateSegments(items, callback) {
  let length = items.length;
  for (let i = 0; i < length; i++) {
    let j = (i + 1) % length;
    callback(items[i], items[j], i, j);
  }
}

export function invertLoop(loop) {
  for (let halfEdge of loop.halfEdges) {
    const t = halfEdge.vertexA;
    halfEdge.vertexA = halfEdge.vertexB;
    halfEdge.vertexB = t;
  }
  loop.halfEdges.reverse();
  linkSegments(loop.halfEdges);
}

export function createFaceFromTwoEdges(e1, e2) {
  const loop = new Loop();
  e1.loop = loop;
  e2.loop = loop;
  loop.halfEdges.push(
    e1,
    HalfEdge.create(e1.vertexB,  e2.vertexA, loop),
    e2,
    HalfEdge.create(e2.vertexB,  e1.vertexA, loop));
  
  let surface = null;
  if (e1.edge.curve.constructor.name == 'Line' && 
      e2.edge.curve.constructor.name == 'Line') {
    const normal = cad_utils.normalOfCCWSeq(loop.halfEdges.map(e => e.vertexA.point));
    surface = createPlaneForLoop(normal, loop);
  } else if ((e1.edge.curve instanceof ApproxCurve) && (e2.edge.curve instanceof ApproxCurve)) {
    const chunk1 = e1.edge.curve.getChunk(e1.edge.vertexA.point, e1.edge.vertexB.point);
    const chunk2 = e2.edge.curve.getChunk(e2.edge.vertexA.point, e2.edge.vertexB.point);
    const n = chunk1.length;
    if (n != chunk2.length) {
      throw 'unsupported';
    }
    surface = new ApproxSurface();
    for (let p = n - 1, q = 0; q < n; p = q ++) {
      const polygon = [ chunk1[p], chunk1[q], chunk2[q], chunk2[p] ];
      surface.mesh.push(polygon);
    }
  } else {
    throw 'unsupported';
  }

  const face = new Face(surface);
  face.outerLoop = loop;
  loop.face = face;
  return face;
}
