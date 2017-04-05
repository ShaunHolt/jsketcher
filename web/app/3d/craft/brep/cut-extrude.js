import {Matrix3, BasisForPlane, ORIGIN} from '../../../math/l3space'
import * as math from '../../../math/math'
import Vector from '../../../math/vector'
import {Extruder} from '../../../brep/brep-builder'
import {BREPValidator} from '../../../brep/brep-validator'
import * as stitching from '../../../brep/stitching'
import {subtract, union} from '../../../brep/operations/boolean'
import {Loop} from '../../../brep/topo/loop'
import {Shell} from '../../../brep/topo/shell'
import {ReadSketchContoursFromFace} from '../sketch/sketch-reader'
import {Segment} from '../sketch/sketch-model'
import {isCurveClass} from '../../cad-utils'

import {BREPSceneSolid} from '../../scene/brep-scene-object'

export function Extrude(app, params) {
  return doOperation(app, params, false);
}

export function Cut(app, params) {
  return doOperation(app, params, true);
}

export function doOperation(app, params, cut) {
  const face = app.findFace(params.face);
  const solid = face.solid;
  let reverse = !cut;
  
  if (params.value < 0) {
    params = fixNegativeValue(params);
    reverse = !reverse;
  }

  const sketch = ReadSketchContoursFromFace(app, face);
  
  const extruder = new ParametricExtruder(params);
  const operand = combineShells(sketch.map(s => extruder.extrude(s, face.brepFace.surface, reverse)));
  BREPValidator.validateToConsole(operand);

  //let result;
  //if (solid instanceof BREPSceneSolid) {
  //  const op = cut ? subtract : union;
  //  result = op(solid.shell, operand);
  //  for (let newFace of result.faces) {
  //    if (newFace.id == face.id) {
  //      newFace.id = undefined;
  //    }
  //  }
  //} else {
  //  if (cut) throw 'unable to cut plane';
  //  result = operand;
  //}
  //stitching.update(result);
  const newSolid = new BREPSceneSolid(operand);
  return {
    outdated: [solid],
    created:  [newSolid]
  }
}

export function fixNegativeValue(params) {
  if (params.value < 0) {
    params = Object.assign({}, params);
    params.value *= -1;
  } 
  return params;
} 

function combineShells(shells) {
  if (shells.length == 1) {
    return shells[0];
  }
  const cutter = new Shell();
  shells.forEach(c => c.faces.forEach(f => cutter.faces.push(f)));
  return cutter;
}

export class ParametricExtruder extends Extruder {
  
  constructor(params) {
    super();
    this.params = params;
  }
  
  getLidSurface(baseSurface) {
    let target;
    this.basis = baseSurface.basis();
    const lidNormal = baseSurface.normal.negate();
    if (this.params.rotation != 0) {
      target = Matrix3.rotateMatrix(this.params.rotation * Math.PI / 180, this.basis[0], ORIGIN).apply(lidNormal);
      if (this.params.angle != 0) {
        target = Matrix3.rotateMatrix(this.params.angle * Math.PI / 180, this.basis[2], ORIGIN)._apply(target);
      }
      target._multiply(Math.abs(this.params.value));
    } else {
      target = lidNormal.multiply(Math.abs(this.params.value));
    }
    this.target = target;
    return baseSurface.move(target).invert();
  }
  
  getLidPointTransformation() {
    return p => p.plus(this.target);
  }
  
  onWallCallback(wallFace, baseTrimmedCurve, lidTrimmedCurve) {
    const group = baseTrimmedCurve.group;
    if (group && group instanceof Segment) {
      if (!group.stitchedSurface) {
        group.stitchedSurface = new stitching.StitchedSurface();
      }
      group.stitchedSurface.addFace(wallFace);
    }
  }
}
