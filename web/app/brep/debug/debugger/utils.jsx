import React from 'react';
import {BLUE, cycleColor, DETECTED_EDGE, DISCARDED_EDGE, GREEN, SALMON, WHITE} from "./colors";
import {distanceAB3} from "../../../math/math";
import BREP_DEBUG from '../brep-debug';

export function getFaceViewObjects(group3d, category, out, face) {
  return getLoopsViewObjects(group3d, category, out, face.loops);
}

export function getLoopsViewObjects(group3d, category, out, loops) {
  forEach(loops, getLoopViewObjects.bind(null, group3d, category, out));
}

export function getLoopViewObjects(group3d, category, out, loop) {
  return getEdgesViewObjects(group3d, category, out, loop.halfEdges);
}

export function getEdgesViewObjects(group3d, category, out, edges) {
  forEach(edges, getEdgeViewObjects.bind(null, group3d, category, out));
}

export const getEdgeViewObjects = findOrCreate.bind(null, (edge, color) => {
  let obj = new THREE.Object3D();
  obj.__tcad_debug_materials = [];
  let points = edge.edge.curve.tessellate();
  if (edge.inverted) {
    points.reverse();
  }

  let material = new THREE.LineBasicMaterial({color, linewidth: 10});
  let  lg = new THREE.Geometry();
  let edgeLength = 0;
  for (let i = 1; i < points.length; ++i) {
    let a = points[i - 1];
    let b = points[i];
    lg.vertices.push(a.three());
    lg.vertices.push(b.three());
    edgeLength += distanceAB3(a, b);
  }
  obj.__tcad_debug_materials.push(material);
  obj.add(new THREE.Line(lg, material));

  
  
  let arrowLength = 15;
  let arrowWidth = 0.2 * arrowLength;
  if (arrowLength > edgeLength * 0.5) {
    arrowLength = edgeLength * 0.5;
  }
  let dir = edge.tangentAtEnd();
  let pos = edge.vertexB.point.minus(dir.multiply(arrowLength * 0.5));
  let cone = new THREE.CylinderGeometry( 0, arrowWidth, arrowLength, 10, 1 );
  let arrow = new THREE.Mesh( cone, new THREE.MeshBasicMaterial( { color} ) );
  if ( dir.y > 0.99999 ) {
    arrow.quaternion.set( 0, 0, 0, 1 );
  } else if ( dir.y < - 0.99999 ) {
    arrow.quaternion.set( 1, 0, 0, 0 );
  } else {
    arrow.quaternion.setFromAxisAngle( new THREE.Vector3().set( dir.z, 0, - dir.x ).normalize(), Math.acos( dir.y ) );
  }
  arrow.position.set(pos.x, pos.y, pos.z);
  
  obj.__tcad_debug_materials.push(arrow.material);
  obj.add(arrow);
  return obj;
});

export const getVertexViewObjects = findOrCreate.bind(null, ({point: {x,y,z}}, color) => {
  let geometry = new THREE.SphereGeometry( 5, 16, 16 );
  let material = new THREE.MeshBasicMaterial( {color} );
  let sphere = new THREE.Mesh(geometry, material);
  sphere.position.x = x;
  sphere.position.y = y;
  sphere.position.z = z;

  sphere.__tcad_debug_materials = [material];
  return sphere;
});

export function findOrCreate(creator, group3d, category, out, topoObj) {
  let id = category + '/' + topoObj.refId;
  let obj = group3d.children.find(obj => obj.__tcad_debug_refId === id);
  if (!obj) {
    obj = creator(topoObj, getInitColor(category, topoObj.constructor.name, topoObj));
    group3d.add(obj);
    obj.__tcad_debug_refId = id;
    obj.__tcad_debug_topoObj = topoObj;
    obj.visible = false;
  }
  out.push(obj);
}

export function setViewObjectsColor(objectsProvider, group3d, category, topoObj, colorGetter) {
  fetchViewObjects(objectsProvider, group3d, category, topoObj)
    .forEach(o => o.__tcad_debug_materials.forEach(m => m.color.setHex(colorGetter(o))));
}

export function fetchViewObjects(objectsProvider, group3d, category, topoObj) {
  let objs = [];
  objectsProvider(group3d, category, objs, topoObj);
  return objs;
}


export function getInitColor(category, objectType, obj) {
  switch (objectType) {
    case 'HalfEdge': 
      switch (category) {
        case 'face_intersection_operandA': return GREEN;
        case 'face_intersection_operandB': return BLUE;
        case 'loop-detection': {
          if (obj) {
            return BREP_DEBUG.booleanDetectedLoopEdges.has(obj) ? DETECTED_EDGE : DISCARDED_EDGE;
          }
        }
        default: return SALMON;
      }
    case 'Vertex':
      return GREEN;
  }
  return WHITE;
}

export function mapIterable(it, fn) {
  const out = [];
  for (let i of it) {
    out.push(fn(i));
  }
  return out;
}

export function forEach(it, fn) {
  for (let i of it) {
    fn(i);
  }
}


export function createObjectsUpdater(viewObjectsProvider, group3d, category, topoObj) {
  let getObjects = out => viewObjectsProvider.bind(null, group3d, category, out, topoObj)();
  return function (func) {
    let out = [];
    getObjects(out);
    out.forEach(func);
    __DEBUG__.render();
  }
}

export function Controls({viewObjectsProvider, group3d, category, topoObj}) {
  let applyToAll = createObjectsUpdater(viewObjectsProvider, group3d, category, topoObj);
  function tweak() {
    let toState = null;
    applyToAll(o => {
      if (toState === null) {
        toState = !o.visible
      }
      o.visible = toState
    });
  }
  function _cycleColor() {
    applyToAll(o => o.__tcad_debug_materials.forEach(m =>  m.color.setHex(cycleColor(m.color.getHex()))));
  }
  return <span>
    <i className='fa fa-fw fa-eye-slash clickable' onClick={tweak}/>
    <i className='fa fa-fw fa-paint-brush clickable' onClick={_cycleColor}/>
  </span>;
}

export function ActiveLabel({viewObjectsProvider, group3d, category, topoObj, children, ...props}) {
  let applyToAll = createObjectsUpdater(viewObjectsProvider, group3d, category, topoObj);
  function onMouseEnter() {
    applyToAll(o => {
      o.__tcad_debug_last_visible = o.visible;
      o.__tcad_debug_materials.forEach(m => {
        m.opacity = 0.7;
        m.transparent = true;
      });
      o.visible = true;
    })
  }
  function onMouseLeave() {
    applyToAll(o => {
      o.visible = o.__tcad_debug_last_visible;
      o.__tcad_debug_materials.forEach(m => {
        m.opacity = 1;
        m.transparent = false;
      });
    });
  }
  return <span {...{onMouseEnter, onMouseLeave, ...props}}>{children}</span>;
} 

export const TAB = '0.5';
