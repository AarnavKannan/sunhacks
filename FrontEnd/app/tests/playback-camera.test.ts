import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceCamera } from "./render/source-camera";
import * as THREE from "three";

const cal = JSON.parse(readFileSync(new URL("../electron/demo-incident/measure/data/br_camera.json", import.meta.url), "utf8")).camera;
const mapping = { X_REF: 94.86, Y_median: -6.411 };
const camera = sourceCamera(cal, mapping);
assert.deepEqual(camera.position, [mapping.X_REF, cal.h_m, mapping.Y_median - cal.cam_Y_m]);
// A point along the real optical axis must project to the centre of the Three.js camera.
const axis = cal.R_world_to_cam[2];
const world = [100 * axis[0], cal.cam_Y_m + 100 * axis[1], cal.h_m + 100 * axis[2]];
const scene = [mapping.X_REF - world[0], world[2], -(world[1] - mapping.Y_median)];
for (let i = 0; i < 3; i++) assert.ok(Math.abs(camera.target[i] - scene[i]) < 1e-10, `optical axis component ${i} flipped`);
assert.ok(camera.direction[2] > 0, "world -Y optical-axis component must become scene +z");
assert.throws(() => sourceCamera(cal, { X_REF: NaN, Y_median: 0 }), /metadata/);
// Independent pinhole projection of ground/body points, including the calibrated roll.
const perspective = new THREE.PerspectiveCamera(camera.fovDeg, 479 / 300, .1, 3000);
perspective.position.set(...camera.position);
perspective.up.set(...camera.up);
perspective.lookAt(...camera.target);
perspective.updateMatrixWorld(true);
for (const [x, y, z] of [[70, -10, 0], [160, -18, 1.5], [300, -28, 0]]) {
  const rel = [x, y - cal.cam_Y_m, z - cal.h_m];
  const q = cal.R_world_to_cam.map((row: number[]) => row.reduce((v, a, i) => v + a * rel[i], 0));
  const expected = [(cal.f_px * q[0] / q[2] + cal.cx) / 479 * 2 - 1, 1 - (cal.f_px * q[1] / q[2] + cal.cy) / 300 * 2];
  const projected = new THREE.Vector3(mapping.X_REF - x, z, -(y - mapping.Y_median)).project(perspective);
  assert.ok(Math.abs(projected.x - expected[0]) < 1e-10 && Math.abs(projected.y - expected[1]) < 1e-10, "source projection differs from calibrated camera");
}
console.log("Source camera: calibrated pinhole projection, optical-axis sign, roll and builder transform passed");
