export class HMSHell {

  constructor() {
    this.faces = [];
  }

  toThreeMesh() {
    const geom = new THREE.Geometry();
    for (let face of this.faces) {
      const off = geom.vertices.length;
      const tess = face.tessellate({maxDepth: 3});
      tess.points.forEach(p => geom.vertices.push(new THREE.Vector3().fromArray(p)));
      for (let faceIndices of tess.faces) {
        
        
        const face = new THREE.Face3(faceIndices[0] + off, faceIndices[1] + off, faceIndices[2] + off);
        geom.faces.push(face);
      }
    }
    geom.computeFaceNormals();
    const material = new THREE.MeshPhongMaterial({
      vertexColors: THREE.FaceColors,
      color: 0xB0C4DE,
    });
    return new THREE.Mesh(geom, material);
  }

}

export class HMLoop {
  constructor(curves) {
    this.curves = curves || [];
    this.innerLoops = [];
  }
}

export class HMFace {
  constructor(surface, boundingLoop) {
    this.surface = surface;
    this.bounds = boundingLoop;
  }

  tessellate(opts) {
    return this.surface.tessellate(opts);
  }
}

export class HMEdge {
  constructor() {
    this.curves = [];
  }
}
