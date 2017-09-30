import PIP from "./pip";
import earcut from 'earcut'
import Vector from "../../math/vector";

export default function A(face) {
  function uv(p) {
    return face.surface.verb.closestParam(p);
  }

  const pt = ([x, y]) => ({x, y});

  const mirrored = isMirrored(face.surface);

  let loops = [];
  for (let loop of face.loops) {
    let pipLoop = [];
    loops.push(pipLoop);
    for (let e of loop.halfEdges) {
      let curvePoints = e.edge.curve.verb.tessellate(1000);
      let inverted = mirrored !== e.inverted;
      if (inverted) {
        curvePoints.reverse();
      }
      curvePoints.pop();
      for (let point of curvePoints) {
        let p = pt(uv(point));
        pipLoop.push(p);
      }
    }
  }

  let tess = face.surface.verb.tessellate();
  let steinerPoints = tess.uvs.map(uv => pt(uv));

  let [outer, ...inners] = loops;
  inners.forEach(inner => inner.reverse());
  let pip = PIP(outer, inners);
  steinerPoints = steinerPoints.filter(pt => pip(pt).inside);

  let points = [];
  let holes = [];


  function pushLoop(loop) {
    for (let pt of loop) {
      points.push(pt.x);
      points.push(pt.y);
    }
  }

  pushLoop(outer);

  for (let inner of inners) {
    holes.push(points.length / 2);
    pushLoop(inner);
  }

  for (let sp of steinerPoints) {
    holes.push(points.length / 2);
    points.push(sp.x);
    points.push(sp.y);
  }

  let scaledPoints = points.map(p => p * 1000);

  let trs = earcut(scaledPoints, holes);

  let output = [];

  function indexToPoint(i) {
    return new Vector().set3(face.surface.verb.point(points[i * 2], points[i * 2 + 1]));
  }

  for (let i = 0; i < trs.length; i += 3) {
    const tr = [trs[i], trs[i + 1], trs[i + 2]];

    __DEBUG__.AddPointPolygon(tr.map( ii => new Vector(scaledPoints[ii * 2], scaledPoints[ii * 2 + 1], 0) ));

    output.push(tr.map(i => indexToPoint(i)));
  }
  return output;
}

export function isMirrored(surface) {
  let a = surface.point(0, 0);
  let b = surface.point(1, 0);
  let c = surface.point(1, 1);
  return b.minus(a).cross(c.minus(a))._normalize().dot(surface.normalUV(0, 0)) < 0;
}



