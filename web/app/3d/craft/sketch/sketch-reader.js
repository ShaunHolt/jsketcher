import * as sm from './sketch-model'
import {Matrix3, AXIS, ORIGIN} from '../../../math/l3space'
import Vector from '../../../math/vector'
import {Graph} from '../../../math/graph'
import * as math from '../../../math/math'
import {HashTable} from '../../../utils/hashmap'

export function ReadSketchFromFace(app, face, reverseGeom) {
  return getSketchedPolygons3D(app, face, reverseGeom);
}

export function ReadSketch(sketch, faceId, readConstructionSegments) {
  let idCounter = 0;
  function genID() {
    return faceId + ":" + (idCounter++);
  }
  const out = {connections : [], loops : [], constructionSegments: []};
  if (sketch.layers !== undefined) {
    for (let layer of sketch.layers) {
      const isConstructionLayer = layer.name == "_construction_";
      if (isConstructionLayer && !readConstructionSegments) continue;
      for (let obj of layer.data) {
        if (isConstructionLayer && obj._class !== 'TCAD.TWO.Segment') continue;
        if (obj.edge !== undefined) continue;
        if (!!obj.aux) continue;
        if (obj._class === 'TCAD.TWO.Segment') {
          const segA = ReadSketchPoint(obj.points[0]);
          const segB = ReadSketchPoint(obj.points[1]);
          const pushOn = isConstructionLayer ? out.constructionSegments : out.connections;
          pushOn.push(new sm.Segment(genID(), segA, segB));
        } else if (obj._class === 'TCAD.TWO.Arc') {
          const arcA = ReadSketchPoint(obj.points[0]);
          const arcB = ReadSketchPoint(obj.points[1]);
          const arcCenter = ReadSketchPoint(obj.points[2]);
          out.connections.push(new sm.Arc(genID(), arcA, arcB, arcCenter));
        } else if (obj._class === 'TCAD.TWO.EllipticalArc') {
          const ep1 = ReadSketchPoint(obj.ep1);
          const ep2 = ReadSketchPoint(obj.ep2);
          const a = ReadSketchPoint(obj.a);
          const b = ReadSketchPoint(obj.b);
          out.connections.push(new sm.EllipticalArc(genID(), ep1, ep2, a, b, obj.r));
        } else if (obj._class === 'TCAD.TWO.BezierCurve') {
          const a = ReadSketchPoint(obj.a);
          const b = ReadSketchPoint(obj.b);
          const cp1 = ReadSketchPoint(obj.cp1);
          const cp2 = ReadSketchPoint(obj.cp2);
          out.connections.push(new sm.BezierCurve(genID(), a, b, cp1, cp2));
        } else if (obj._class === 'TCAD.TWO.Circle') {
          const circleCenter = ReadSketchPoint(obj.c);
          out.loops.push(new sm.Circle(genID(), circleCenter, obj.r));
        } else if (obj._class === 'TCAD.TWO.Ellipse') {
          const ep1 = ReadSketchPoint(obj.ep1);
          const ep2 = ReadSketchPoint(obj.ep2);
          out.loops.push(new sm.Ellipse(genID(), ep1, ep2, obj.r));
        }
      }
    }
  }
  return out;
}

export function ReadSketchPoint(arr) {
  return new Vector(arr[1][1], arr[2][1], 0)
}

export function getSketchedPolygons3D(app, face, reverseGeom) {
  const savedFace = localStorage.getItem(app.faceStorageKey(face.id));
  if (savedFace == null) return null;
  const geom = ReadSketch(JSON.parse(savedFace), face.id, false);
  const sketchLoops = sketchToPaths(geom);
  if (reverseGeom) {
    sketchLoops.forEach(l => l.reverse());
  }
  return sketchLoops.map(loop => loop.transferOnSurface(face.surface));
}

export function sketchToPaths(geom) {

  const dict = HashTable.forVector2d();
  const edges = HashTable.forDoubleArray();

  const segs = geom.connections;

  function edgeKey(a, b) {
    return [a.x, a.y, b.x, b.y];
  }

  const points = [];
  function memDir(a, b) {
    let dirs = dict.get(a);
    if (dirs === null) {
      dirs = [];
      dict.put(a, dirs);
      points.push(a);
    }
    dirs.push(b);
  }

  for (let seg of segs) {
    const a = seg.a;
    const b = seg.b;

    memDir(a, b);
    memDir(b, a);
    edges.put(edgeKey(a, b), seg);
  }

  const graph = {

    connections : function(e) {
      const dirs = dict.get(e);
      return dirs === null ? [] : dirs;
    },

    at : function(index) {
      return points[index];
    },

    size : function() {
      return points.length;
    }
  };

  const loops = Graph.findAllLoops(graph, dict.hashCodeF, dict.equalsF);
  const result = [];
  for (let loop of loops) {
    const contour = new sm.Contour();
    for (let pi = 0; pi < loop.length; ++pi) {
      const point = loop[pi];
      const next = loop[(pi + 1) % loop.length];
      let edge = edges.get(edgeKey(point, next));
      if (edge === null) {
        edge = edges.get(edgeKey(next, point));
        edge.invert();
      }
      contour.add(edge);
    }

    if (contour.segments.length >= 3) {
      const approxPoints = contour.approximate(10).map(s => s.a);
      if (!math.isCCW(approxPoints)) contour.reverse();
      result.push(contour);
    } else {
      console.warn("Points count < 3!");
    }
  }
  
  for (let loop of geom.loops) {
    const loopedCurve = new sm.Contour(loop);
    const approxPoints = loopedCurve.approximate(10).map(s => s.a);
    if (!math.isCCW(approxPoints)) loopedCurve.reverse();
    result.push(loopedCurve);
  }
  return result;
}