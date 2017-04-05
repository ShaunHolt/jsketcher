
export class Curve {

  constructor() {
  }

  intersectCurve(curve) {
    throw 'not implemented';
  }
  
  parametricEquation(t) {
    throw 'not implemented';
  }
}

export class TrimmedCurve {

  constructor(a, b, curve, group) {
    this.curve = curve;
    this.a = a;
    this.b = b;
    this.group = group;
  }
}