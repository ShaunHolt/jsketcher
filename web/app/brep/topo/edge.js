import {TopoObject} from './topo-object'
import Vector from "../../math/vector";

export class Edge extends TopoObject {

  constructor(curve, a, b) {
    super();
    this.curve = curve;
    this.halfEdge1 = new HalfEdge(this, false, a, b);
    this.halfEdge2 = new HalfEdge(this, true, b, a);
  }
}

class HalfEdge extends TopoObject {

  constructor(edge, inverted, a, b) {
    super();
    this.edge = edge;
    this.inverted = inverted;
    this.vertexA = a;
    this.vertexB = b;
    this.loop = null;
    this.next = null;
    this.prev = null;
  }

  twin() {
    return this.edge.halfEdge1 === this ? this.edge.halfEdge2 : this.edge.halfEdge1;
  }

  tangent(point) {
    let u = this.edge.curve.closestParam(point.data());
    let tangent = new Vector().set3(this.edge.curve.tangent(u));
    if (this.inverted) {
      tangent._negate();
    }
    return tangent;
  }
}
