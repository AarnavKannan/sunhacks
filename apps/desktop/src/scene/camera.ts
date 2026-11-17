export type CameraAdjustments = {
  panX: number;
  panY: number;
  panZ: number;
  zoom: number;
  tilt: number;
  rotate: number;
};

export const CAMERA_ADJUSTMENT_BASE: CameraAdjustments = {
  panX: 0,
  panY: 0,
  panZ: 0,
  zoom: 1,
  tilt: 0,
  rotate: 0,
};
