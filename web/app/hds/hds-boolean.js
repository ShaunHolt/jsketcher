
const TOL = 1e-6;

function Boolean(a, b, type) {

  intersect(a, b);
  const faces = [];
  const newAllFaces = [];
  collectFaces(a, faces);
  collectFaces(b, faces);

  for (let face of faces) {
    const newFaces = processFace(face);  
    for (let newFace of newFaces) {
      newAllFaces.push(newFace);
    }
  }  

}

function intersect(a, b) {
  for (let f1 of a.faces) {
    for (let f2 of b.faces) {
      let curves = verb.geom.Intersect.surfaces( srf1, srf2, TOL );  
      curves = splitCurves(f1, curves);
      curves = splitCurves(f2, curves);
      f1.addCurves(curves);
      f2.addCurves(curves);
     
    }
  }
}

function processFace(face) {

  const graph = createGraph(face.curves);



}


