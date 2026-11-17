// Calibrated bottom-right (crash) camera -> three.js camera in the app's scene frame.
// Mirrors electron/demo-incident/measure/cam.py exactly (same rot(), same principal point).
//
// World W (cam.py): X along the road away from the camera, Y to the camera's right, Z up;
//   camera at (0, cy0, h). Pinhole, principal point (239.5, 150) in the 479x300 tile.
// Plan (spec) frame: x = X_REF - X_W, y = Y_W - Y_MEDIAN  (build-demo-spec.py)
// three.js scene:    (x_plan, height, -y_plan)
export const X_REF = 95.06;
export const Y_MEDIAN = -4.803;
export const TILE_W = 479;
export const TILE_H = 300;
export const CX = 239.5;
export const CY = 150.0;

export type Vec3 = [number, number, number];
type M3 = number[][];

const mul = (a: M3, b: M3): M3 => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));

export function rot(yaw: number, pitch: number, roll: number): M3 {
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
  const Ry = [[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]];
  const base = [[0, 1, 0], [0, 0, -1], [1, 0, 0]];
  const Rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
  const Rz = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
  return mul(mul(mul(Rz, Rx), base), Ry);
}

export type Calib = { params: number[]; lines: Record<string, number>; van: number[]; van_w: number; report?: any };

export const worldToScene = (X: number, Y: number, Z = 0): Vec3 => [X_REF - X, Z, -(Y - Y_MEDIAN)];
export const planToScene = (x: number, y: number, z = 0): Vec3 => [x, z, -y];

/** cam.py to_img(): the calibration's own projection (tile pixels, 479x300). */
export function calibProject(cal: Calib, X: number, Y: number, Z = 0): [number, number] {
  const [f, h, yaw, pitch, roll, cy0] = cal.params;
  const R = rot(yaw, pitch, roll);
  const w = [X, Y - cy0, Z - h];
  const c = R.map((r) => r[0] * w[0] + r[1] * w[1] + r[2] * w[2]);
  return [f * c[0] / c[2] + CX, f * c[1] / c[2] + CY];
}

/** Pose for viewer.setCamera + the roll the harness applies to the rendered image. */
export function sourceCamera(cal: Calib) {
  const [f, h, yaw, pitch, roll, cy0] = cal.params;
  const R = rot(yaw, pitch, roll);
  const a = R[2]; // optical axis in W (unaffected by roll)
  const position = worldToScene(0, cy0, h);
  const direction: Vec3 = [-a[0], a[2], -a[1]];
  const target = position.map((v, i) => v + 100 * direction[i]) as Vec3;
  const d = R[1]; // camera "down" in W
  const up: Vec3 = [d[0], -d[2], d[1]]; // -down in scene (with roll)
  return { position, target, direction, up, roll, fovDeg: 2 * Math.atan(CY / f) * 180 / Math.PI, f, h, cy0 };
}
