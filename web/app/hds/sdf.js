import * as math from '../math/math'
import Vector from '../math/vector'

export const createSphere = (c, r) => (p) => math.distanceAB3(c, p) - r;
export const sdfTransform = (sd, tr) => {
  tr = tr.invert();
  return (p) => sd(tr.apply(p))
};
export const sdfIntersection = (a, b) => (p) => Math.max(a(p), b(p));
export const sdfSubtract = (a, b) => (p) => Math.max(a(p), -b(p));

export const sdfNurbs = (nurbs) => (p) => {
  const uv = nurbs.closestParam(p.data());
  const point = new Vector().set3(nurbs.point(uv[0], uv[1]));
  const normal = new Vector().set3(nurbs.normal(uv[0], uv[1]));
  const length = p.minus(point).length();
  const sign  = normal.dot(p.minus(point)) > 0 ? 1 : -1;
  return length * sign;
};

function rayMarch(sdf, rayBuilder, bitmap, shader, depth) {
  for (let x = 0; x < bitmap.width; x++) {
    for (let y = 0; y < bitmap.height; y++) {
      const ray = rayBuilder(x, y);
      let rayParam = 0;
      let hit = false;
      while (rayParam < depth) {
        const point = ray.origin.plus(ray.dir.multiply(rayParam));
        const distance = sdf(point);
        if (math.equal(distance, 0)) {
          bitmap.set(x, y, shader(point));
          hit = true;
          break;
        }
        rayParam += distance;
      }
      if (!hit) {
        bitmap.set(x, y, null)
      }
    }
  }
}

export function rayMarchOntoCanvas(sdf, camera, width, height, canvas, depth) {

  function rayBuilder(px, py) {
    const x = ( px / width ) * 2 - 1;
    const y = - ( py / height ) * 2 + 1;

    let origin = new THREE.Vector3();
    let dir = new THREE.Vector3();
    if ( camera instanceof THREE.PerspectiveCamera ) {
      origin.setFromMatrixPosition( camera.matrixWorld );
      dir.set( x, y, 0.5 ).unproject( camera ).sub( origin ).normalize();
    } else if ( camera instanceof THREE.OrthographicCamera ) {
      origin.set( x, y, - 1 ).unproject( camera );
      dir.set( 0, 0, - 1 ).transformDirection( camera.matrixWorld );
    }
    return {
      origin: new Vector().setV(origin),
      dir: new Vector().setV(dir)
    };
  }

  const ctx = canvas.getContext('2d');
  const bitmap = {
    set: function(x, y, color) {
      ctx.fillStyle = color === null ? "#CCCCCC" : color;
      ctx.fillRect(x, y, 1, 1);
    },
    width, height
  };
  const light = new Vector(-1000, 300, 100);
  const color = new THREE.Color(0x00AA00);
  function shader(p) {
      const normal = p.normalize(),
      L1 = light.minus(p).normalize();
    const diffuse   = Math.abs(normal.dot(L1)),
    kd        = 1,//0.1,
    ka        = 0;//0.9;
    let deffused = color.clone().multiplyScalar(kd * diffuse + ka);
    return '#' + deffused.getHexString();
  }
  rayMarch(sdf, rayBuilder, bitmap, shader, depth);
}

