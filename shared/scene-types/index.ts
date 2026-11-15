/**
 * Scene package contract (schema/ is the source of truth).
 *
 * Units are meters and seconds. The world is Y-up. The origin is a point on
 * the median; the road runs along X. Quaternions are [x, y, z, w].
 * Time `t` is seconds from the first frame.
 *
 * incident-demo has `impact_time_s: null` and no impact event. Seeking the
 * "impact" event must fail cleanly. Do not treat 0 as impact, and do not show
 * T− times unless `impact_time_s` is set. Show clip time instead.
 * Labels are measured paint plus type. Look vehicles up by alias
 * ("the red car"), not by a fixed id.
 */

export const SCHEMA_VERSION = "1.0.0" as const;

export type SchemaVersion = typeof SCHEMA_VERSION;
export type VehicleType = "car" | "van" | "truck";
export type LabelSource = "vlm" | "manual" | "measured";
export type CarriagewayId = "a" | "b";
export type EventType = "impact" | "brake" | "rest" | "lane_change" | "pass";
export type SplatFormat = "ply" | "spz";
export type Vec3 = readonly [number, number, number];
/** [x, y, z, w] */
export type Quat = readonly [number, number, number, number];

export interface Units {
  length: "m";
  time: "s";
}

export interface Origin {
  landmark: string;
  description: string;
}

export interface SourceVideo {
  filename: string;
  sha256: string;
  codec: string;
  width: number;
  height: number;
  fps: number;
  duration_s: number;
  frame_count: number;
  has_audio: boolean;
}

/** Inclusive pixel span. Mosaic y grows downward from the top left. */
export type PixelSpan = readonly [number, number];

export interface MosaicLayout {
  width: number;
  height: number;
  image_origin: "top-left";
  column_gutter_x: PixelSpan;
  row_gutter_y: PixelSpan;
  letterbox_y: PixelSpan;
}

export interface RoadCarriageway {
  heading: "+X" | "-X";
  z_sign: -1 | 1;
  cameras: string[];
}

export interface Road {
  stretch_m: number;
  x_min_m: number;
  x_max_m: number;
  lane_width_m: number;
  lanes_per_carriageway: number;
  shoulder: boolean;
  median_half_width_m: number;
  carriageways: { a: RoadCarriageway; b: RoadCarriageway };
}

export interface ModelRecord {
  role: string;
  name: string;
  version: string;
  seed: number;
}

export interface Seeds {
  schematic: number;
  kinematics: number;
}

export interface ClassColor {
  name: string;
  hex: string;
}

/** Burned-in box colors. Paint color is on each entity. */
export interface ClassLegend {
  car: ClassColor;
  van: ClassColor;
  truck: ClassColor;
}

export interface PipelineInfo {
  name: string;
  version: string;
  command: string;
  config: string;
}

export interface Manifest {
  id: string;
  schema_version: SchemaVersion;
  description: string;
  fps: number;
  duration_s: number;
  frame_count: number;
  /** Null when this clip has no impact. */
  impact_time_s: number | null;
  units: Units;
  up_axis: "Y";
  crs: "local";
  origin: Origin;
  source: SourceVideo;
  mosaic: MosaicLayout;
  road: Road;
  /** True when speeds were authored and smoothed, not measured from video. */
  tracks_are_schematic: boolean;
  splat_format: SplatFormat;
  models: ModelRecord[];
  seeds: Seeds;
  class_legend: ClassLegend;
  pipeline: PipelineInfo;
}

/** Fixed MVP uncertainty. Not a fitted covariance. */
export interface Sigma {
  pos_m: number;
  speed_mps: number;
}

export interface Sample {
  t: number;
  /** Vehicle center, meters. */
  pos: Vec3;
  quat: Quat;
  /** World-frame velocity, m/s. */
  vel: Vec3;
  /**
   * World-frame acceleration, m/s².
   * Longitudinal acceleration is the dot product of `acc` with the heading
   * direction (cos θ, 0, −sin θ), where θ is `heading_deg` in radians.
   */
  acc: Vec3;
  speed_mps: number;
  /** 0 faces +X. 180 faces −X. Positive heading turns toward −Z. */
  heading_deg: number;
  /** Radians per second about +Y. */
  yaw_rate: number;
  sigma: Sigma;
}

export interface Visibility {
  t_start: number;
  t_end: number;
}

export interface Track {
  entity_id: string;
  carriageway: CarriagewayId;
  /** Samples exist only while the vehicle is inside the reconstructed stretch. */
  visibility: Visibility;
  samples: Sample[];
}

export interface TracksFile {
  tracks: Track[];
}

export interface Dims {
  /** Local +X. */
  length: number;
  /** Local +Z. */
  width: number;
  /** Local +Y. */
  height: number;
}

export interface Entity {
  id: string;
  label: string;
  /** Paint color. */
  color: string;
  color_hex: string;
  type: VehicleType;
  make: string | null;
  model: string | null;
  /** Proxy-mesh size when the splat is a shared class blob. */
  dims_m: Dims;
  aliases: string[];
  confidence: number;
  label_source: LabelSource;
  carriageway: CarriagewayId;
  /** Package-relative path. Several entities may share one class file. */
  splat: string;
}

export interface EntitiesFile {
  entities: Entity[];
}

export interface SceneEvent {
  id: string;
  t: number;
  type: EventType;
  /** For a pass, the first id is the vehicle that overtakes. */
  vehicles: string[];
  note: string;
}

export interface EventsFile {
  events: SceneEvent[];
}

/** Pixel rectangle in the mosaic. Y grows downward. */
export interface MosaicCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Intrinsics {
  model: "pinhole";
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

export interface Extrinsics {
  /** Camera looks down its local −Z axis. */
  convention: "camera_to_world_opengl";
  position_m: Vec3;
  quaternion: Quat;
}

export interface Camera {
  id: string;
  static: boolean;
  mosaic_crop: MosaicCrop;
  intrinsics: Intrinsics;
  extrinsics: Extrinsics;
  note: string;
}

export interface CamerasFile {
  cameras: Camera[];
}

export interface ScenePackage {
  manifest: Manifest;
  tracks: TracksFile;
  entities: EntitiesFile;
  events: EventsFile;
  cameras: CamerasFile;
}
