import * as THREE from "three";
import type { StaticObject } from "@/gemini/spec";
import { staticCollisionGeometry } from "@/scene/collision";
import { ROAD_Y, type Painter } from "@/scene/draw";
import { fixedObjectMaterial } from "@/scene/environment";

/** Exact footprint extrusion: a low verge stays low; barriers and far hedges stay separate. */
export function drawStaticObjects(painter: Painter, objects: StaticObject[]) {
  for (const object of objects) {
    if (object.footprint_m.length < 3 || object.height_m <= 0) continue;
    const shape = new THREE.Shape();
    object.footprint_m.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: object.height_m, bevelEnabled: false, steps: 1 });
    // Extrude +Z becomes height; shape +Y becomes scene -Z, exactly as collision geometry.
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, fixedObjectMaterial(object.material, painter.s));
    mesh.name = object.id;
    mesh.position.y = ROAD_Y;
    mesh.castShadow = object.height_m > 0.3;
    mesh.receiveShadow = true;
    mesh.userData.uvTile = /grass|verge|hedge/.test(object.material) ? 3 : 2;
    mesh.userData.staticObject = object;
    mesh.userData.collision = staticCollisionGeometry(object);
    painter.group.add(mesh);
  }
  painter.group.userData.staticColliders = objects.map(staticCollisionGeometry);
}
