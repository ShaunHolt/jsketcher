
export class Ray {
  constructor(pt, dir, reachableDistance) {
    this.pt = pt;
    this.dir = dir;
    this.curve = new verb.geom.Line(pt.data(), pt.plus(dir.multiply(reachableDistance)).data());
  }
} 