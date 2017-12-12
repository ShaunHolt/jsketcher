import {TopoObject} from './topo-object'
import {Loop} from './loop'
import PIP from '../../3d/tess/pip';

export class Face extends TopoObject {

  constructor(surface) {
    super();
    this.surface = surface;
    this.shell = null;
    this.outerLoop = new Loop(this);
    this.innerLoops = [];
    this.defineIterable('loops', () => loopsGenerator(this));
    this.defineIterable('edges', () => halfEdgesGenerator(this));
    Object.defineProperty(this, "id", {
      get: () => this.data.id,
      set: (value) => this.data.id = value,
    });
  }

  createWorkingPolygon() {
    return [this.outerLoop, ...this.innerLoops].map(loop => loop.tess().map(pt => this.surface.workingPoint(pt)));
  }

  env2D() {
    if (this.__2d === undefined) {
      let workingPolygon = this.createWorkingPolygon();
      let [inner, ...outers] = workingPolygon;
      this.__2d = {
        pip: PIP(inner, outers),
        workingPolygon
      }
    }
    return this.__2d;
  }
}

export function* loopsGenerator(face) {
  if (face.outerLoop !== null) {
    yield face.outerLoop;
  }
  for (let innerLoop of face.innerLoops) {
    yield innerLoop;
  }
}

export function* halfEdgesGenerator(face) {
  for (let loop of face.loops) {
    for (let halfEdge of loop.halfEdges) {
      yield halfEdge;
    }
  }
}
