// A source comparison needs the builder's transform; estimating it from a van pose silently
// registers an old fallback (or a synthetic fixture) as though it were calibrated real data.
export type BuildMapping = {
  X_REF: number;
  Y_median: number;
  synthetic?: boolean;
  output?: { sha256?: string };
  sources?: { br_camera?: { sha256?: string } };
};
export type SourceCalibration = {
  f_px: number;
  cy: number;
  h_m: number;
  cam_Y_m: number;
  R_world_to_cam: number[][];
};

export function sourceCamera(cal: SourceCalibration, mapping: BuildMapping) {
  if (![mapping.X_REF, mapping.Y_median, cal.f_px, cal.cy, cal.h_m, cal.cam_Y_m].every(Number.isFinite)
    || cal.f_px <= 0 || cal.cy <= 0 || cal.R_world_to_cam?.length !== 3
    || !cal.R_world_to_cam.every((row) => row.length === 3 && row.every(Number.isFinite))) {
    throw new Error("Source comparison needs finite X_REF/Y_median builder metadata and br_camera.json calibration");
  }
  const axis = cal.R_world_to_cam[2]; // optical axis, expressed in world (X,Y,Z)
  // Builder: plan = (X_REF-X, Y-Y_median); scene = (plan_x, Z, -plan_y).
  const position: [number, number, number] = [mapping.X_REF, cal.h_m, -(cal.cam_Y_m - mapping.Y_median)];
  const direction: [number, number, number] = [-axis[0], axis[2], -axis[1]];
  const down = cal.R_world_to_cam[1];
  const up: [number, number, number] = [down[0], -down[2], down[1]];
  const target = position.map((v, i) => v + 100 * direction[i]) as [number, number, number];
  return { position, target, direction, up, fovDeg: 2 * Math.atan(cal.cy / cal.f_px) * 180 / Math.PI };
}
