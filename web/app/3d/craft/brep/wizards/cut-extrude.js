import {CURRENT_SELECTION as S} from './wizard'
import {PreviewWizard, SketchBasedPreviewer} from './preview-wizard'
import {ParametricExtruder, fixNegativeValue} from '../cut-extrude'
import {TriangulatePolygons} from '../../../triangulation'
import Vector from '../../../../math/vector'

const METADATA = [
  ['value'   , 'number',  50],
  ['prism'   , 'number',  1 ,  {min: 0, step: 0.1, round: 1}],
  ['angle'   , 'number',  0 ,  {}],
  ['rotation', 'number',  0 ,  {step: 5}],
  ['face'    , 'face'  ,  S  ]
];

export class CutWizard extends PreviewWizard {
  constructor(app, initialState) {
    super(app, 'CUT', METADATA, initialState)
  }
  
  createPreviewObject(app, params) {
    return CUT_PREVIEWER.create(app, params);
  }

  uiLabel(name) {
    if ('value' == name) return 'depth';
    return super.uiLabel(name);
  }
}

export class ExtrudeWizard extends PreviewWizard {
  constructor(app, initialState) {
    super(app, 'EXTRUDE', METADATA, initialState)
  }

  createPreviewObject(app, params) {
    return EXTRUDE_PREVIEWER.create(app, params);
  }

  uiLabel(name) {
    if ('value' == name) return 'height';
    return super.uiLabel(name);
  }
}

export class ExtrudePreviewer extends SketchBasedPreviewer {

  constructor(inversed) {
    super();
    this.inversed = inversed;
  }
  
  createImpl(app, params, sketch, face) {
    const normal = face.normal();
    let reverseNormal = this.inversed;
    if (params.value < 0) {
      params = fixNegativeValue(params);
      reverseNormal = !reverseNormal;
    }
    const pe = new ParametricExtruder(params);

    let baseSurface = face.brepFace.surface;
    if (reverseNormal) {
      baseSurface = baseSurface.invert();
    }
    const lidSurface = pe.getLidSurface(baseSurface);
    const triangles = [];
    for (let contour of sketch) {

      const base = contour.transferOnSurface(baseSurface);
      //contour.reverse();
      const lid = contour.transferOnSurface(lidSurface, pe.getLidApproxTransformation(), pe.getLidPointTransformation());
      
      const n = base.length;
      for (let q = 0; q < n; q ++) {
        //triangles.push([ base[q].a, base[q].b, lid[q].b ]);
        //triangles.push([ lid[q].b, lid[q].a, base[q].a ]);
      }
      //TriangulatePolygons([base.map(t => t.a)], baseSurface.normal, (v) => v.toArray(), (arr) => new Vector().set3(arr))
      //  .forEach(tr => triangles.push(tr));
      
      TriangulatePolygons([lid.map(t => t.a)], lidSurface.normal, (v) => v.toArray(), (arr) => new Vector().set3(arr))
        .forEach(tr => triangles.push(tr));
    }
    return triangles;
  }
}

const EXTRUDE_PREVIEWER = new ExtrudePreviewer(false);
const CUT_PREVIEWER = new ExtrudePreviewer(true);
