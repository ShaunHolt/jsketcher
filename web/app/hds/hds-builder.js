import verb from 'verb-nurbs'
import {Matrix3, ORIGIN, AXIS} from '../math/l3space'
import {HMFace, HMLoop, HMSolid} from './hds-model'

export function createBox(w, h, d) {
  const hw = w * 0.5;
  const hh = h * 0.5;
  const hd = d * 0.5;
  const solid = new HMSolid();
  let Line = verb.geom.Line;
  const base = new verb.geom.ExtrudedSurface(new Line([hw, -hh, -hd], [-hw, -hh, -hd]), [0, 0, d]);
  const lid = new verb.geom.ExtrudedSurface(new Line([hw, hh, hd], [-hw, hh, hd]), [0, 0, -d]);

  let _90_D = Math.PI * 0.5;

  const xRot = Matrix3.rotateMatrix(_90_D, AXIS.X,ORIGIN).toArray();
  const yRot = Matrix3.rotateMatrix(_90_D, AXIS.Y,ORIGIN).toArray();

  const wall1 = base.transform(xRot);
  const wall3 = lid.transform(xRot);
  const wall2 = wall1.transform(yRot);
  const wall4 = wall3.transform(yRot);

  // solid.faces.push(new HMFace(base, new HMLoop(base.boundaries())));
  // solid.faces.push(new HMFace(lid, new HMLoop(lid.boundaries())));
  // solid.faces.push(new HMFace(wall1, new HMLoop(wall1.boundaries())));
  // solid.faces.push(new HMFace(wall2, new HMLoop(wall2.boundaries())));
  // solid.faces.push(new HMFace(wall3, new HMLoop(wall3.boundaries())));
  solid.faces.push(new HMFace(wall4, new HMLoop(wall4.boundaries())));
  return solid;
}