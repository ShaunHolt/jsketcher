import Vector from '../../math/vector'
import {EDGE_AUX, FACE_CHUNK} from '../../brep/stitching'
import {normalOfCCWSeq} from '../cad-utils'
import {TriangulateFace} from '../tess/triangulation'
import {SceneSolid, SceneFace, WIREFRAME_MATERIAL, createSolidMaterial} from './scene-object'
import brepTess, {isMirrored} from '../tess/brep-tess'

const SMOOTH_RENDERING = false //true;

export class BREPSceneSolid extends SceneSolid {

  constructor(shell, type, skin) {
    super(type, undefined, skin);
    this.shell = shell;
    this.createGeometry();
  }

  createGeometry() {
    this.mesh = new THREE.Object3D();
    this.cadGroup.add(this.mesh);
    this.createFaces();
    this.createEdges();
    this.createVertices();
  }

  createFaces() {

    for (let brepFace of this.shell.faces) {
      const sceneFace = new BREPSceneFace(brepFace, this);
      this.sceneFaces.push(sceneFace);
      const geom = new THREE.Geometry();
      geom.dynamic = true;
      geom.faceVertexUvs[0] = [];

      function tess(nurbs) {
        // __DEBUG__.AddNormal(nurbs.point(0.5,0.5), nurbs.normalInMiddle());
        const tess = nurbs.verb.tessellate({maxDepth: 3});
        const trs = tess.faces.map(faceIndices => {
          return faceIndices.map(i => tess.points[i]).map(p => new Vector().set3(p));
        });
        trs.forEach(tr => tr.reverse());
        if (isMirrored(nurbs)) {

        }
        return trs;
      }


      const polygons = tess(brepFace.surface);
      const stitchedSurface = brepFace.data[FACE_CHUNK];
      const nurbs = stitchedSurface ? stitchedSurface.origin : undefined;

      for (let p = 0; p < polygons.length; ++p) {
        const off = geom.vertices.length;
        const poly = polygons[p];
        const vLength = poly.length;
        if (vLength < 3) continue;
        const firstVertex = poly[0];
        geom.vertices.push(firstVertex.three());
        geom.vertices.push(poly[1].three());
        for (let i = 2; i < vLength; i++) {
          geom.vertices.push(poly[i].three());
          const a = off;
          const b = i - 1 + off;
          const c = i + off;
          let points = [firstVertex, poly[i - 1], poly[i]];

          let normalOrNormals;
          if (nurbs && SMOOTH_RENDERING) {
            function normal(v) {
              const uv = nurbs.closestParam(v.data());
              const vec = new THREE.Vector3();
              vec.set.apply(vec, nurbs.normal(uv[0], uv[1]));
              vec.normalize();
              return vec;
            }

            normalOrNormals = points.map(v => normal(v));
          } else {
            normalOrNormals = threeV(brepFace.surface.normal(firstVertex));
          }
          const face = new THREE.Face3(a, b, c);

          geom.faceVertexUvs[0].push( points.map(p => new THREE.Vector2().fromArray(brepFace.surface.verb.closestParam(p.data()))));
          // face.materialIndex = gIdx++;
          geom.faces.push(face);
        }
        geom.computeFaceNormals();
        let texture = createTexture(brepFace);
        let material = createSolidMaterial(Object.assign({}, this.skin, {
          map: texture,
          transparent: true,
          color: '0xffffff'

        }));
        this.mesh.add(new THREE.Mesh(geom, material))
        //view.setFaceColor(sceneFace, utils.isSmoothPiece(group.shared) ? 0xFF0000 : null);
      }

    }


    //geom.mergeVertices();
  }

  createEdges() {
    const visited = new Set();
    for (let edge of this.shell.edges) {
      if (edge.data[EDGE_AUX] === undefined) {
        const line = new THREE.Line(undefined, WIREFRAME_MATERIAL);
        const contour = edge.curve.verb.tessellate();
        for (let p of contour) {
          line.geometry.vertices.push(new THREE.Vector3().fromArray(p));
        }
        this.wireframeGroup.add(line);
        line.__TCAD_EDGE = edge;
        edge.data['scene.edge'] = line;
      }

    }
  }

  createVertices() {
  }
}

class BREPSceneFace extends SceneFace {
  constructor(brepFace, solid) {
    super(solid, brepFace.id);
    brepFace.id = this.id;
    this.brepFace = brepFace;
    brepFace.data['scene.face'] = this;
  }


  normal() {
    return this.brepFace.surface.normal;
  }

  depth() {
    return this.brepFace.surface.w;
  }

  surface() {
    return this.brepFace.surface;
  }

  getBounds() {
    const bounds = [];
    for (let loop of this.brepFace.loops) {
      bounds.push(loop.asPolygon().map(p => new Vector().setV(p)));
    }
    return bounds;
  }
}

function createTexture(brepFace) {
  const w = 200;
  const h = 200;
  function getCanvas() {
    if (brepFace.data.__canvas === undefined) {
      let canvas = brepFace.data.__canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 200;
    }
    return brepFace.data.__canvas;
  }
  let canvas = getCanvas();
  let ctx = canvas.getContext("2d");



  // ctx.fillStyle = '0xB0C4DE'
  // ctx.fillRect(0,0, 400,400)

  // ctx.fillStyle = 'transparent'
  // ctx.beginPath();
  // ctx.moveTo(25, 25);
  // ctx.lineTo(105, 25);
  // ctx.lineTo(25, 105);
  // ctx.fill();

  brepFace.
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {

    }
  }

  ctx.fillStyle = 'red'
  ctx.beginPath();
  ctx.moveTo(55, 55);
  ctx.lineTo(175, 75);
  ctx.lineTo(75, 175);
  ctx.fill();

  let texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function triangulateToThree(faces, geom) {
  const result = [];
  let gIdx = 0;

  function addFace(face) {
    face.materialIndex = gIdx++;
    geom.faces.push(face);
  }

  for (let brepFace of faces) {
    const groupStart = geom.faces.length;
    const polygons = brepTess(brepFace);
    const stitchedSurface = brepFace.data[FACE_CHUNK];
    const nurbs = stitchedSurface ? stitchedSurface.origin : undefined;
    let normalOrNormals = threeV(brepFace.surface.normalInMiddle());
    for (let p = 0; p < polygons.length; ++p) {
      const off = geom.vertices.length;
      const poly = polygons[p];
      const vLength = poly.length;
      if (vLength < 3) continue;
      const firstVertex = poly[0];
      geom.vertices.push(firstVertex.three());
      geom.vertices.push(poly[1].three());
      for (let i = 2; i < vLength; i++) {
        geom.vertices.push(poly[i].three());
        const a = off;
        const b = i - 1 + off;
        const c = i + off;

        if (nurbs && SMOOTH_RENDERING) {
          function normal(v) {
            const uv = nurbs.closestParam(v.data());
            const vec = new THREE.Vector3();
            vec.set.apply(vec, nurbs.normal(uv[0], uv[1]));
            vec.normalize();
            return vec;
          }

          normalOrNormals = [firstVertex, poly[i - 1], poly[i]].map(v => normal(v));
        }
        const face = new THREE.Face3(a, b, c, normalOrNormals);
        createTexture(brepFace);
        addFace(face);
      }
      //view.setFaceColor(sceneFace, utils.isSmoothPiece(group.shared) ? 0xFF0000 : null);
    }
    result.push(new FaceGroup(brepFace, groupStart, geom.faces.length));
  }
  return result;
}

export function nurbsToThreeGeom(nurbs, geom) {
  const off = geom.vertices.length;
  const tess = nurbs.tessellate({maxDepth: 3});
  tess.points.forEach(p => geom.vertices.push(new THREE.Vector3().fromArray(p)));
  for (let faceIndices of tess.faces) {
    const face = new THREE.Face3(faceIndices[0] + off, faceIndices[1] + off, faceIndices[2] + off);
    geom.faces.push(face);
  }
}

class FaceGroup {
  constructor(brepFace, groupStart, groupEnd) {
    this.brepFace = brepFace;
    this.groupStart = groupStart;
    this.groupEnd = groupEnd;
  }
}

function threeV(v) {
  return new THREE.Vector3(v.x, v.y, v.z)
}


export function pip( pt, loop, surface, uvPt ) {

  function VertexResult(vertex) {
    this.inside = true;
    this.vertex = vertex;
  }

  function EdgeResult(edge) {
    this.inside = true;
    this.edge = edge;
  }

  if (!uvPt) {
    uvPt = surface.toUV(pt);
  }

  function isLine(edge) {
    return !edge.edge || !edge.edge.curve || edge.edge.curve.isLine;
  }

  const uvCoords = new Map();
  for( let edge of loop.halfEdges ) {
    const uv = surface.toUV(edge.vertexA.point);
    if (math.areEqual(uvPt.y, uv.y, TOLERANCE) && math.areEqual(uvPt.x, uv.x, TOLERANCE)) {
      return new VertexResult(edge.vertexA);
    }
    uvCoords.set(edge.vertexA, uv);
  }

  const grads = [];
  for( let edge of loop.halfEdges ) {
    const a = uvCoords.get(edge.vertexA);
    const b = uvCoords.get(edge.vertexB);
    let dy;
    if (isLine(edge)) {
      dy = b.y - a.y;
    } else {
      const tangent = edge.edge.curve.tangent(edge.vertexA.point);
      dy = surface.toUV(tangent).y;
      if (edge.edge.invertedToCurve) {
        dy *= -1;
      }
    }
    if (math.areEqual(dy, 0, TOLERANCE)) {
      grads.push(0)
    } else if (dy > 0) {
      grads.push(1)
    } else {
      grads.push(-1)
    }
  }

  function nextGrad(start) {
    for(let i = 0; i < grads.length; ++i) {
      const idx = (i + start + 1) % grads.length;
      if (grads[idx] != 0) {
        return grads[idx];
      }
    }
  }

  function prevGrad(start) {
    for(let i = 0; i < grads.length; ++i) {
      const idx = (start - i - 1 + grads.length) % grads.length;
      if (grads[idx] != 0) {
        return grads[idx];
      }
    }
  }

  const skip = new Set();

  let ray = null;
  let inside = false;
  for( let i = 0; i < loop.halfEdges.length; ++i) {

    const edge = loop.halfEdges[i];

    var shouldBeSkipped = skip.has(edge.vertexA) || skip.has(edge.vertexB);

    const a = uvCoords.get(edge.vertexA);
    const b = uvCoords.get(edge.vertexB);

    const aEq = math.areEqual(uvPt.y, a.y, TOLERANCE);
    const bEq = math.areEqual(uvPt.y, b.y, TOLERANCE);

    if (aEq) {
      skip.add(edge.vertexA);
    }
    if (bEq) {
      skip.add(edge.vertexB);
    }

    if (math.areVectorsEqual(a, b, TOLERANCE)) {
      console.error('unable to classify invalid polygon');
    }

    if (isLine(edge)) {
      let edgeLowPt  = a;
      let edgeHighPt = b;

      let edgeDx = edgeHighPt.x - edgeLowPt.x;
      let edgeDy = edgeHighPt.y - edgeLowPt.y;

      if (aEq && bEq) {
        if ( ( ( edgeHighPt.x <= uvPt.x ) && ( uvPt.x <= edgeLowPt.x ) ) ||
          ( ( edgeLowPt.x <= uvPt.x ) && ( uvPt.x <= edgeHighPt.x ) ) ) {
          return new EdgeResult(edge);
        } else {
          continue;
        }
      }

      if (shouldBeSkipped) {
        continue;
      }

      if ( edgeDy < 0 ) {
        edgeLowPt  = b; edgeDx = - edgeDx;
        edgeHighPt = a; edgeDy = - edgeDy;
      }
      if (!aEq && !bEq && ( uvPt.y < edgeLowPt.y || uvPt.y > edgeHighPt.y ) ) {
        continue;
      }

      if (bEq) {
        if (grads[i] * nextGrad(i) < 0) {
          continue;
        }
      } else if (aEq) {
        if (grads[i] * prevGrad(i) < 0) {
          continue;
        }
      }

      let perpEdge = edgeDx * (uvPt.y - edgeLowPt.y) - edgeDy * (uvPt.x - edgeLowPt.x);
      if ( math.areEqual(perpEdge, 0, TOLERANCE) ) return new EdgeResult(edge);		// uvPt is on contour ?
      if ( perpEdge < 0 ) {
        continue;
      }
      inside = ! inside;		// true intersection left of uvPt

    } else {

      if (aEq && bEq) {
        if (math.areEqual(edge.edge.curve.closestDistanceToPoint(pt), 0, TOLERANCE)) {
          return new EdgeResult(edge);
        } else {
          continue;
        }
      }

      if (shouldBeSkipped) {
        continue;
      }

      if (bEq) {
        if (grads[i] * nextGrad(i) < 0) {
          continue;
        }
      } else if (aEq) {
        if (grads[i] * prevGrad(i) < 0) {
          continue;
        }
      }

      if (math.areEqual(edge.edge.curve.closestDistanceToPoint(pt), 0, TOLERANCE)) {
        return new EdgeResult(edge);
      }

      if (ray == null) {

        let rayEnd = pt.copy();
        //fixme!!
        rayEnd.x = 1000000;//surface.fromUV(surface.domainU()[1]).x;
        ray = edge.edge.curve.createLinearNurbs(pt, rayEnd);
      }

      const hits = edge.edge.curve.intersect(ray);

      for (let hit of hits) {
        //if ray just touches
        const onlyTouches = math.areEqual(edge.edge.curve.tangent(hit).normalize().y, 0, TOLERANCE);
        if (!onlyTouches) {
          inside = ! inside;
        }
      }
    }
  }

  return	{inside};
}