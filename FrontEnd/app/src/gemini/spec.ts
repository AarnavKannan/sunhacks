/**
 * What Gemini reports about an incident after watching the footage, and the checks that turn
 * its answer into something the engine can trust.
 *
 * No path aliases here: the Electron main process (electron/gemini.ts) imports this file too.
 *
 * Plan frame (what Gemini is asked to use): a top-down map of the site in meters.
 *   x: along the main road; y: across it, positive to the LEFT when facing +x.
 *   Origin: the centre of the junction (intersection, roundabout) or, on a plain road, the point
 *   on the main road's centre line nearest the crash.
 *   heading_deg: 0 = facing +x, 90 = facing +y (counter-clockwise seen from above).
 * The scene (three.js) frame is x = plan x, z = -plan y, so the road builders, which lay the main
 * road along x with "right of +x" at +z, line up with no further transform.
 */

/** Bump with any change to electron/gemini-skill/*.md, so stored analyses are redone with the new instructions. */
export const PROMPT_VERSION = "codex-scene-v6";

/** A small fixed set: the surroundings matter little to the reconstruction, so Gemini only picks one. */
export const ENVIRONMENT_PRESETS = {
  clear_green: { sky: "clear", snow: 0, vegetation: "green", road: "dry" },
  clear_arid: { sky: "clear", snow: 0, vegetation: "arid", road: "dry" },
  clear_winter: { sky: "clear", snow: 0.3, vegetation: "dormant", road: "dry" },
  overcast_dry: { sky: "overcast", snow: 0, vegetation: "dormant", road: "dry" },
  overcast_wet: { sky: "overcast", snow: 0, vegetation: "green", road: "wet" },
  snowy: { sky: "overcast", snow: 0.45, vegetation: "dormant", road: "dry" },
  dusk: { sky: "dusk", snow: 0, vegetation: "green", road: "dry" },
  night_dry: { sky: "night", snow: 0, vegetation: "dormant", road: "dry" },
  night_wet: { sky: "night", snow: 0, vegetation: "dormant", road: "wet" },
} as const;
export type EnvironmentPreset = keyof typeof ENVIRONMENT_PRESETS;
export const ENVIRONMENT_PRESET_NAMES = Object.keys(ENVIRONMENT_PRESETS) as EnvironmentPreset[];

export const ROAD_KINDS = ["straight", "divided_highway", "intersection", "roundabout"] as const;
export type RoadKind = (typeof ROAD_KINDS)[number];
export const ROAD_CLASSES = ["motorway", "arterial", "collector", "local"] as const;
export const REGIONS = ["US", "DE", "EU"] as const;
export const SURFACES = ["dry", "wet", "snow", "ice"] as const;

export const OBJECT_CATEGORIES = ["sedan", "hatchback", "suv", "pickup", "van", "truck", "bus", "motorcycle", "bicycle", "pedestrian", "other"] as const;
export type ObjectCategory = (typeof OBJECT_CATEGORIES)[number];

export const FORCE_CAUSES = ["braking", "accelerating", "steering", "impact", "sliding", "rolling_resistance", "drag", "coasting", "other"] as const;
export type ForceCause = (typeof FORCE_CAUSES)[number];

/**
 * Provenance of a keyframe (measured reconstructions). Absent = an ordinary measured/model sample.
 * "measured": observed in the source frame. "interpolated": between observed samples (detection gap).
 * "occluded-rest": object hidden but known to be at rest (e.g. the wreck after its annotation is lost).
 * "out-of-view-extrapolated": object has left the camera; continued from its last measured motion.
 * "edge-extrapolated": background track extended along its own lane from its first/last observed
 * velocity to the drawn road ends, so it does not pop in/out mid-road. Never a lane change.
 */
export const SAMPLE_SOURCES = ["measured", "interpolated", "occluded-rest", "out-of-view-extrapolated", "edge-extrapolated"] as const;
export type SampleSource = (typeof SAMPLE_SOURCES)[number];

export type Keyframe = {
  t_s: number;
  x_m: number;
  y_m: number;
  heading_deg: number;
  speed_mps: number;
  /** Measured reconstructions only. */
  src?: SampleSource;
  /** 1-sigma position uncertainty, metres (measured reconstructions only). */
  sigma_m?: number;
};

/**
 * A fixed scene object that vehicles can hit (e.g. the bushy median divider). Plan frame, metres.
 * Immovable: zero velocity/acceleration at every time; contacts with it act on the vehicle only.
 */
export type StaticObject = {
  id: string;
  kind: "median_divider" | "barrier" | "other";
  label: string;
  /** Ground footprint polygon, plan frame (x, y) metres, counter-clockwise, not closed. */
  footprint_m: [number, number][];
  height_m: number;
  /** Rendering/material description, e.g. "hedge_over_steel_barrier". */
  material: string;
  /** Contact parameters for vehicle-static contact. */
  friction: number;
  restitution: number;
  stiffness_n_per_m: number;
  immovable: true;
  source: "measured" | "inferred";
  sigma_m: number;
  note: string;
};

/** A force Gemini read off the footage, plan frame, newtons. */
export type ForceSample = { t_s: number; fx_n: number; fy_n: number; cause: ForceCause; note: string };

export type SpecObject = {
  id: string;
  label: string;
  category: ObjectCategory;
  color_name: string;
  color_hex: string;
  make: string | null;
  model: string | null;
  /** "crash": takes part in the crash, reconstructed precisely. "background": everything else, approximate. */
  involvement: "crash" | "background";
  length_m: number;
  width_m: number;
  /** Optional measured cuboid height; absent for older/model-estimated scenes. */
  height_m?: number;
  mass_kg: number;
  visible_from_s: number;
  visible_to_s: number;
  keyframes: Keyframe[];
  /** Only for crash objects (pass 2). */
  forces: ForceSample[];
  /** Where it ended up, for crash objects. */
  rest: { x_m: number; y_m: number; heading_deg: number } | null;
  confidence: number;
  /**
   * From the per-camera census (background traffic): which carriageway and lane, and when it was
   * on screen. The engine places the vehicle from this when it has no usable keyframes.
   */
  lane_hint?: LaneHint;
};

export type LaneHint = {
  /** "with" = travels +x (same way as the crash vehicles); "against" = -x. */
  direction: "with" | "against";
  /** 1 = the lane next to the median (or centre line). */
  lane_from_median: number;
  first_seen_s: number;
  last_seen_s: number;
  speed_mps: number;
  stopped: boolean;
  /** Cameras it was seen in. */
  cameras: string[];
};

export type Contact = {
  /** Object ids; `b` may be a StaticObject id (then kind = "vehicle-static"). */
  a: string;
  b: string;
  t_s: number;
  x_m: number;
  y_m: number;
  /** Normal from a to b, plan degrees. */
  normal_deg: number;
  /** Measured reconstructions only (all optional). */
  kind?: "vehicle-vehicle" | "vehicle-static";
  /** Source video frame index of first contact (t_s = frame / fps). */
  frame?: number;
  /** Impulse magnitude, N·s, along the normal (on b from a; static objects do not move). */
  impulse_ns?: number;
  source?: "measured" | "inferred";
  sigma_s?: number;
  note?: string;
};

export type IncidentSpec = {
  prompt_version: string;
  title: string;
  location_guess: string;
  summary: string;
  duration_s: number;
  views: {
    video_index: number;
    description: string;
    camera_kind: string;
    moving: boolean;
    time_offset_s: number;
    /** Which way +x traffic moves in this camera's picture. */
    plus_x_traffic: "toward_camera" | "away_from_camera" | "not_visible";
  }[];
  environment_preset: EnvironmentPreset;
  road: {
    kind: RoadKind;
    region: (typeof REGIONS)[number];
    road_class: (typeof ROAD_CLASSES)[number];
    lanes_each_way: number;
    cross_lanes_each_way: number;
    surface: (typeof SURFACES)[number];
    grade_percent: number;
    speed_limit_mps: number | null;
    /**
     * Measured cross-section (verified reconstructions only; optional, divided highways). Every
     * painted line of each carriageway as a distance (m) from plan y = 0 (the median barrier):
     * inner edge line first, then each lane line, outer edge line last; n lanes = n + 1 values.
     * Overrides lanes_each_way and the standard lane width; forward = the +x carriageway (plan y < 0).
     */
    lane_lines_forward_m?: number[];
    lane_lines_backward_m?: number[];
  };
  /** Wind, plan frame: the direction it blows toward, and its speed. */
  wind: { toward_deg: number; speed_mps: number };
  crash: { start_s: number; end_s: number; kind: string; description: string; participants: string[]; contacts: Contact[] } | null;
  objects: SpecObject[];
  /** Fixed collision objects (measured reconstructions only), e.g. the median divider. */
  static_objects?: StaticObject[];
  /** Anything Gemini wasn't sure about, shown to the user and stored for audit. */
  caveats: string[];
};

// ---------------------------------------------------------------------------
// JSON schemas sent to Gemini (structured output). Kept flat and small: every field costs tokens.

const num = { type: "number" };
const str = { type: "string" };
const keyframeSchema = {
  type: "object",
  properties: { t_s: num, x_m: num, y_m: num, heading_deg: num, speed_mps: num },
  required: ["t_s", "x_m", "y_m", "heading_deg", "speed_mps"],
};

export const PASS1_SCHEMA = {
  type: "object",
  properties: {
    title: str,
    location_guess: str,
    summary: str,
    duration_s: num,
    views: {
      type: "array",
      items: {
        type: "object",
        properties: {
          video_index: { type: "integer" },
          description: str,
          camera_kind: str,
          moving: { type: "boolean" },
          time_offset_s: num,
          plus_x_traffic: { type: "string", enum: ["toward_camera", "away_from_camera", "not_visible"] },
        },
        required: ["video_index", "description", "camera_kind", "moving", "time_offset_s", "plus_x_traffic"],
      },
    },
    environment_preset: { type: "string", enum: ENVIRONMENT_PRESET_NAMES },
    road: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ROAD_KINDS },
        region: { type: "string", enum: REGIONS },
        road_class: { type: "string", enum: ROAD_CLASSES },
        lanes_each_way: { type: "integer" },
        cross_lanes_each_way: { type: "integer" },
        surface: { type: "string", enum: SURFACES },
        grade_percent: num,
        speed_limit_mps: { type: ["number", "null"] },
      },
      required: ["kind", "region", "road_class", "lanes_each_way", "cross_lanes_each_way", "surface", "grade_percent", "speed_limit_mps"],
    },
    wind: { type: "object", properties: { toward_deg: num, speed_mps: num }, required: ["toward_deg", "speed_mps"] },
    crash: {
      type: ["object", "null"],
      properties: { start_s: num, end_s: num, kind: str, description: str, participants: { type: "array", items: str } },
      required: ["start_s", "end_s", "kind", "description", "participants"],
    },
    objects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: str,
          label: str,
          category: { type: "string", enum: OBJECT_CATEGORIES },
          color_name: str,
          color_hex: str,
          make: { type: ["string", "null"] },
          model: { type: ["string", "null"] },
          involvement: { type: "string", enum: ["crash", "background"] },
          length_m: num,
          width_m: num,
          mass_kg: num,
          visible_from_s: num,
          visible_to_s: num,
          confidence: num,
          keyframes: { type: "array", items: keyframeSchema },
        },
        required: [
          "id", "label", "category", "color_name", "color_hex", "make", "model", "involvement",
          "length_m", "width_m", "mass_kg", "visible_from_s", "visible_to_s", "confidence", "keyframes",
        ],
      },
    },
    caveats: { type: "array", items: str },
  },
  required: ["title", "location_guess", "summary", "duration_s", "views", "environment_preset", "road", "wind", "crash", "objects", "caveats"],
} as const;

/** Census: every vehicle one camera sees, in that camera's own terms (no plan coordinates). */
export const CENSUS_SCHEMA = {
  type: "object",
  properties: {
    vehicles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ref: str,
          category: { type: "string", enum: OBJECT_CATEGORIES },
          color_name: str,
          color_hex: str,
          toward_camera: { type: "boolean" },
          lane_from_median: { type: "integer" },
          first_seen_s: num,
          last_seen_s: num,
          speed_mps: num,
          stopped: { type: "boolean" },
        },
        required: ["ref", "category", "color_name", "color_hex", "toward_camera", "lane_from_median", "first_seen_s", "last_seen_s", "speed_mps", "stopped"],
      },
    },
  },
  required: ["vehicles"],
} as const;
export type CensusVehicle = {
  ref: string;
  category: ObjectCategory;
  color_name: string;
  color_hex: string;
  toward_camera: boolean;
  lane_from_median: number;
  first_seen_s: number;
  last_seen_s: number;
  speed_mps: number;
  stopped: boolean;
};

/** Merge: which census entries are the same vehicle, and which pass-1 object each one is. */
export const MERGE_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: { entries: { type: "array", items: str }, matches_object_id: { type: ["string", "null"] } },
        required: ["entries", "matches_object_id"],
      },
    },
  },
  required: ["groups"],
} as const;

/** The incident scan: a short, dense look at every camera for anything crash-like. */
export const SCAN_KINDS = ["contact", "hard_braking", "swerve", "spin", "stopped_vehicle", "debris", "near_miss", "other"] as const;
export const SCAN_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          t_s: num,
          camera: str,
          kind: { type: "string", enum: SCAN_KINDS },
          vehicles: str,
          lane: str,
          description: str,
          confidence: num,
        },
        required: ["t_s", "camera", "kind", "vehicles", "lane", "description", "confidence"],
      },
    },
  },
  required: ["events"],
} as const;
/** A close look at one candidate: did a collision really happen? */
export const VERIFY_SCHEMA = {
  type: "object",
  properties: {
    collision: { type: "boolean" },
    first_contact_s: { type: ["number", "null"] },
    vehicles: str,
    lane: str,
    description: str,
    confidence: num,
  },
  required: ["collision", "first_contact_s", "vehicles", "lane", "description", "confidence"],
} as const;

export type ScanEvent = { t_s: number; camera: string; kind: (typeof SCAN_KINDS)[number]; vehicles: string; lane: string; description: string; confidence: number };

export const PASS2_SCHEMA = {
  type: "object",
  properties: {
    start_s: num,
    end_s: num,
    contacts: {
      type: "array",
      items: {
        type: "object",
        properties: { a: str, b: str, t_s: num, x_m: num, y_m: num, normal_deg: num },
        required: ["a", "b", "t_s", "x_m", "y_m", "normal_deg"],
      },
    },
    participants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: str,
          keyframes: { type: "array", items: keyframeSchema },
          forces: {
            type: "array",
            items: {
              type: "object",
              properties: { t_s: num, fx_n: num, fy_n: num, cause: { type: "string", enum: FORCE_CAUSES }, note: str },
              required: ["t_s", "fx_n", "fy_n", "cause", "note"],
            },
          },
          rest: {
            type: ["object", "null"],
            properties: { x_m: num, y_m: num, heading_deg: num },
            required: ["x_m", "y_m", "heading_deg"],
          },
        },
        required: ["id", "keyframes", "forces", "rest"],
      },
    },
    caveats: { type: "array", items: str },
  },
  required: ["start_s", "end_s", "contacts", "participants", "caveats"],
} as const;

// ---------------------------------------------------------------------------
// Sanitizing: Gemini's numbers are estimates; clamp them to what a road scene can physically be.

const finite = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const text = (value: unknown, fallback = "") => (typeof value === "string" ? value.trim().slice(0, 400) : fallback);
const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

/** Typical size and mass by category, used when Gemini's guess is missing or implausible. */
export const CATEGORY_DEFAULTS: Record<ObjectCategory, { length: number; width: number; mass: number }> = {
  sedan: { length: 4.7, width: 1.82, mass: 1500 },
  hatchback: { length: 4.2, width: 1.78, mass: 1250 },
  suv: { length: 4.8, width: 1.92, mass: 1900 },
  pickup: { length: 5.6, width: 2.0, mass: 2300 },
  van: { length: 5.2, width: 2.0, mass: 2200 },
  truck: { length: 8.5, width: 2.5, mass: 9000 },
  bus: { length: 12, width: 2.55, mass: 12000 },
  motorcycle: { length: 2.1, width: 0.8, mass: 250 },
  bicycle: { length: 1.8, width: 0.6, mass: 95 },
  pedestrian: { length: 0.5, width: 0.5, mass: 75 },
  other: { length: 4.5, width: 1.8, mass: 1500 },
};

const MAX_SPEED = 70; // m/s, ~157 mph

function keyframes(raw: unknown, duration: number): Keyframe[] {
  if (!Array.isArray(raw)) return [];
  const out: Keyframe[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const k = item as Record<string, unknown>;
    const t = finite(k.t_s, Number.NaN);
    const x = finite(k.x_m, Number.NaN);
    const y = finite(k.y_m, Number.NaN);
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      t_s: clamp(t, 0, duration),
      x_m: clamp(x, -2000, 2000),
      y_m: clamp(y, -2000, 2000),
      heading_deg: finite(k.heading_deg, 0),
      speed_mps: clamp(finite(k.speed_mps, 0), 0, MAX_SPEED),
      ...(SAMPLE_SOURCES.includes(k.src as SampleSource) ? { src: k.src as SampleSource } : {}),
      ...(typeof k.sigma_m === "number" && Number.isFinite(k.sigma_m) && k.sigma_m >= 0 ? { sigma_m: k.sigma_m } : {}),
    });
  }
  out.sort((a, b) => a.t_s - b.t_s);
  // Drop keyframes closer than 20 ms in time: they make the spline tangents blow up.
  return out.filter((k, i) => i === 0 || k.t_s - out[i - 1].t_s >= 0.02);
}

function forces(raw: unknown, duration: number): ForceSample[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => ({
      t_s: clamp(finite(f.t_s, 0), 0, duration),
      // 2 MN is far beyond any real crash pulse for road vehicles; anything larger is noise.
      fx_n: clamp(finite(f.fx_n, 0), -2e6, 2e6),
      fy_n: clamp(finite(f.fy_n, 0), -2e6, 2e6),
      cause: pick(f.cause, FORCE_CAUSES, "other"),
      note: text(f.note),
    }))
    .sort((a, b) => a.t_s - b.t_s);
}

function slug(value: string, used: Set<string>) {
  const base = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "object";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

function measuredLaneLines(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 16) return undefined;
  if (!raw.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 200)) return undefined;
  return raw.every((v, i) => i === 0 || v > raw[i - 1]) ? [...raw] : undefined;
}

function restingPose(raw: unknown): SpecObject["rest"] {
  if (!raw || typeof raw !== "object") return null;
  const rest = raw as Record<string, unknown>;
  if (typeof rest.x_m !== "number" || typeof rest.y_m !== "number" || !Number.isFinite(rest.x_m) || !Number.isFinite(rest.y_m)) return null;
  return { x_m: rest.x_m, y_m: rest.y_m, heading_deg: finite(rest.heading_deg, 0) };
}

/** Validates pass 1 (and optionally merges pass 2) into a spec the engine can run. Throws if unusable. */
export function sanitizeSpec(pass1: unknown, pass2?: unknown): IncidentSpec {
  if (!pass1 || typeof pass1 !== "object") throw new Error("Codex returned no scene description.");
  const p = pass1 as Record<string, any>;
  const duration = clamp(finite(p.duration_s, 0), 0, 600);
  if (duration < 1) throw new Error("Codex couldn't tell how long the footage is.");

  const road = (p.road ?? {}) as Record<string, unknown>;
  const forwardLines = measuredLaneLines(road.lane_lines_forward_m);
  const backwardLines = measuredLaneLines(road.lane_lines_backward_m);
  const used = new Set<string>();
  const idMap = new Map<string, string>();
  const objects: SpecObject[] = [];
  for (const raw of Array.isArray(p.objects) ? p.objects : []) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const category = pick(o.category, OBJECT_CATEGORIES, "other");
    const defaults = CATEGORY_DEFAULTS[category];
    const frames = keyframes(o.keyframes, duration);
    if (frames.length === 0) continue;
    const originalId = text(o.id) || text(o.label) || category;
    const id = slug(originalId, used);
    idMap.set(originalId, id);
    const length = finite(o.length_m, defaults.length);
    const width = finite(o.width_m, defaults.width);
    const mass = finite(o.mass_kg, defaults.mass);
    const hex = text(o.color_hex);
    objects.push({
      id,
      label: text(o.label, `${text(o.color_name)} ${category}`.trim()),
      category,
      color_name: text(o.color_name, "grey"),
      color_hex: /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#8a8f98",
      make: text(o.make) || null,
      model: text(o.model) || null,
      involvement: o.involvement === "crash" ? "crash" : "background",
      // Keep sizes within ±40 % of the class norm: a wrong guess must not make a car look like a bus.
      length_m: clamp(length, defaults.length * 0.6, defaults.length * 1.4),
      width_m: clamp(width, defaults.width * 0.6, defaults.width * 1.4),
      ...(typeof o.height_m === "number" && Number.isFinite(o.height_m) && o.height_m > 0 ? { height_m: clamp(o.height_m, 0.3, 6) } : {}),
      mass_kg: clamp(mass, defaults.mass * 0.5, defaults.mass * 2),
      visible_from_s: clamp(finite(o.visible_from_s, frames[0].t_s), 0, duration),
      visible_to_s: clamp(finite(o.visible_to_s, frames.at(-1)!.t_s), 0, duration),
      keyframes: frames,
      forces: forces(o.forces, duration),
      rest: restingPose(o.rest),
      confidence: clamp(finite(o.confidence, 0.5), 0, 1),
    });
  }
  if (objects.length === 0) throw new Error("Codex didn't find any vehicles to reconstruct.");

  const staticObjects: StaticObject[] = [];
  for (const raw of Array.isArray(p.static_objects) ? p.static_objects : []) {
    if (!raw || typeof raw !== "object") continue;
    const footprint: [number, number][] = Array.isArray(raw.footprint_m) ? raw.footprint_m
      .filter((point: unknown) => Array.isArray(point) && point.length === 2 && point.every((v: unknown) => typeof v === "number" && Number.isFinite(v)))
      .map((point: number[]) => [clamp(point[0], -2000, 2000), clamp(point[1], -2000, 2000)]) : [];
    if (footprint.length > 1 && footprint[0][0] === footprint.at(-1)![0] && footprint[0][1] === footprint.at(-1)![1]) footprint.pop();
    const area = footprint.reduce((sum, point, i) => {
      const next = footprint[(i + 1) % footprint.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    if (footprint.length < 3 || footprint.length > 64 || Math.abs(area) < 1e-6) continue;
    if (area < 0) footprint.reverse();
    const originalId = text(raw.id) || text(raw.label) || "static-object";
    // A malformed static object must not steal an existing vehicle's contact identity.
    if (idMap.has(originalId)) continue;
    const id = slug(originalId, used);
    idMap.set(originalId, id);
    staticObjects.push({
      id, kind: pick(raw.kind, ["median_divider", "barrier", "other"] as const, "other"),
      label: text(raw.label, "Fixed object"), footprint_m: footprint,
      height_m: clamp(finite(raw.height_m, 0.5), 0, 20), material: text(raw.material, "unknown"),
      friction: clamp(finite(raw.friction, 0.5), 0, 2), restitution: clamp(finite(raw.restitution, 0.1), 0, 1),
      stiffness_n_per_m: clamp(finite(raw.stiffness_n_per_m, 1e6), 1, 1e9), immovable: true,
      source: pick(raw.source, ["measured", "inferred"] as const, "inferred"),
      sigma_m: Math.max(0, finite(raw.sigma_m, 1)), note: text(raw.note),
    });
  }

  const resolveId = (raw: unknown) => {
    const value = text(raw);
    return idMap.get(value) ?? (objects.some((o) => o.id === value) ? value : null);
  };
  const resolveVehicleId = (raw: unknown) => {
    const id = resolveId(raw);
    return objects.some((object) => object.id === id) ? id : null;
  };
  const contactList = (raw: unknown, defaultTime: number): Contact[] => {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((contact): Contact[] => {
      const a = resolveVehicleId(contact?.a), b = resolveId(contact?.b);
      if (!a || !b || a === b) return [];
      const fixed = staticObjects.some((object) => object.id === b);
      return [{
        a, b, t_s: clamp(finite(contact.t_s, defaultTime), 0, duration),
        x_m: finite(contact.x_m, 0), y_m: finite(contact.y_m, 0), normal_deg: finite(contact.normal_deg, Number.NaN),
        ...(fixed || contact.kind ? { kind: fixed ? "vehicle-static" as const : "vehicle-vehicle" as const } : {}),
        ...(typeof contact.frame === "number" && Number.isInteger(contact.frame) && contact.frame >= 0 ? { frame: contact.frame } : {}),
        ...(typeof contact.impulse_ns === "number" && Number.isFinite(contact.impulse_ns) && contact.impulse_ns >= 0 ? { impulse_ns: contact.impulse_ns } : {}),
        ...(contact.source === "measured" || contact.source === "inferred" ? { source: contact.source } : {}),
        ...(typeof contact.sigma_s === "number" && Number.isFinite(contact.sigma_s) && contact.sigma_s >= 0 ? { sigma_s: contact.sigma_s } : {}),
        ...(typeof contact.note === "string" ? { note: contact.note } : {}),
      }];
    }).sort((a, b) => a.t_s - b.t_s);
  };

  let crash: IncidentSpec["crash"] = null;
  const c = p.crash as Record<string, unknown> | null | undefined;
  if (c && typeof c === "object") {
    const participants = (Array.isArray(c.participants) ? c.participants : []).map(resolveVehicleId).filter((id): id is string => !!id);
    const start = clamp(finite(c.start_s, Number.NaN), 0, duration);
    if (participants.length > 0 && Number.isFinite(start)) {
      crash = {
        start_s: start,
        end_s: clamp(finite(c.end_s, start + 1.5), start, duration),
        kind: text(c.kind, "collision"),
        description: text(c.description),
        participants: [...new Set(participants)],
        contacts: contactList(c.contacts, start),
      };
    }
  }
  // Involvement follows the crash list, whatever each object said about itself.
  for (const object of objects) object.involvement = crash?.participants.includes(object.id) ? "crash" : "background";

  const caveats = (Array.isArray(p.caveats) ? p.caveats : []).map((v: unknown) => text(v)).filter(Boolean);

  if (pass2 && typeof pass2 === "object" && crash) {
    const q = pass2 as Record<string, any>;
    crash.start_s = clamp(finite(q.start_s, crash.start_s), 0, duration);
    crash.end_s = clamp(finite(q.end_s, crash.end_s), crash.start_s, duration);
    if (Array.isArray(q.contacts)) crash.contacts = contactList(q.contacts, crash.start_s);
    for (const rawParticipant of Array.isArray(q.participants) ? q.participants : []) {
      const object = objects.find((o) => o.id === resolveId(rawParticipant?.id));
      if (!object) continue;
      const dense = keyframes(rawParticipant.keyframes, duration);
      if (dense.length >= 2) {
        // Dense crash-window keyframes replace pass 1's coarse ones inside that window.
        const from = dense[0].t_s;
        const to = dense.at(-1)!.t_s;
        object.keyframes = [...object.keyframes.filter((k) => k.t_s < from - 0.3 || k.t_s > to + 0.3), ...dense].sort((x, y) => x.t_s - y.t_s);
      }
      object.forces = forces(rawParticipant.forces, duration);
      object.rest = restingPose(rawParticipant.rest) ?? object.rest;
    }
    for (const v of Array.isArray(q.caveats) ? q.caveats : []) if (text(v)) caveats.push(text(v));
  }
  if (crash && crash.contacts.length === 0 && crash.participants.length >= 2) {
    // No contact list: assume the first two participants meet at the crash start.
    crash.contacts.push({ a: crash.participants[0], b: crash.participants[1], t_s: crash.start_s, x_m: Number.NaN, y_m: Number.NaN, normal_deg: Number.NaN });
  }

  const wind = (p.wind ?? {}) as Record<string, unknown>;
  return {
    prompt_version: PROMPT_VERSION,
    title: text(p.title, "Reconstructed incident"),
    location_guess: text(p.location_guess, "Location unknown"),
    summary: text(p.summary),
    duration_s: duration,
    views: (Array.isArray(p.views) ? p.views : []).map((v: any, i: number) => ({
      video_index: Math.round(finite(v?.video_index, i)),
      description: text(v?.description),
      camera_kind: text(v?.camera_kind, "other"),
      moving: Boolean(v?.moving),
      time_offset_s: clamp(finite(v?.time_offset_s, 0), -600, 600),
      plus_x_traffic: pick(v?.plus_x_traffic, ["toward_camera", "away_from_camera", "not_visible"] as const, "not_visible"),
    })),
    environment_preset: pick(p.environment_preset, ENVIRONMENT_PRESET_NAMES, "clear_green"),
    road: {
      kind: pick(road.kind, ROAD_KINDS, "straight"),
      region: pick(road.region, REGIONS, "US"),
      road_class: pick(road.road_class, ROAD_CLASSES, "arterial"),
      lanes_each_way: forwardLines ? forwardLines.length - 1 : clamp(Math.round(finite(road.lanes_each_way, 1)), 1, 5),
      cross_lanes_each_way: clamp(Math.round(finite(road.cross_lanes_each_way, 1)), 1, 4),
      surface: pick(road.surface, SURFACES, "dry"),
      grade_percent: clamp(finite(road.grade_percent, 0), -12, 12),
      speed_limit_mps: typeof road.speed_limit_mps === "number" && road.speed_limit_mps > 0 ? clamp(road.speed_limit_mps, 3, 45) : null,
      ...(forwardLines ? { lane_lines_forward_m: forwardLines } : {}),
      ...(backwardLines ? { lane_lines_backward_m: backwardLines } : {}),
    },
    wind: { toward_deg: finite(wind.toward_deg, 0), speed_mps: clamp(finite(wind.speed_mps, 0), 0, 40) },
    crash,
    objects,
    ...(staticObjects.length ? { static_objects: staticObjects } : {}),
    caveats,
  };
}

/**
 * Adds the census to a sanitized spec: every merged census vehicle that isn't already a pass-1
 * object becomes a background object placed by lane and timing; matched ones gain the lane hint.
 * `groups` comes from the merge step; entries are "<video index>:<ref>".
 */
export function applyCensus(
  spec: IncidentSpec,
  census: { camera: string; videoIndex: number; vehicles: CensusVehicle[] }[],
  groups: { entries: string[]; matches_object_id: string | null }[],
  maxObjects = 150,
): { added: number; matched: number; skipped: number } {
  const byKey = new Map<string, { camera: string; videoIndex: number; v: CensusVehicle }>();
  for (const c of census) for (const v of c.vehicles) byKey.set(`${c.videoIndex}:${v.ref}`, { camera: c.camera, videoIndex: c.videoIndex, v });
  // Entries the merge step left out become their own group, so nobody is dropped.
  const grouped = new Set(groups.flatMap((g) => g.entries));
  const all = [
    ...groups.map((g) => ({ ...g, entries: g.entries.filter((e) => byKey.has(e)) })),
    ...[...byKey.keys()].filter((k) => !grouped.has(k)).map((k) => ({ entries: [k], matches_object_id: null as string | null })),
  ].filter((g) => g.entries.length);
  const used = new Set(spec.objects.map((o) => o.id));
  let added = 0;
  let matched = 0;
  let skipped = 0;
  for (const group of all) {
    const hints = group.entries
      .map((e) => byKey.get(e)!)
      .map(({ camera, videoIndex, v }) => {
        const view = spec.views.find((w) => w.video_index === videoIndex);
        // A camera whose +x direction is unknown: assume +x traffic comes toward it.
        const plusToward = view?.plus_x_traffic !== "away_from_camera";
        return { camera, v, direction: (Boolean(v.toward_camera) === plusToward ? "with" : "against") as LaneHint["direction"] };
      })
      .filter((h) => Number.isFinite(h.v.first_seen_s) && Number.isFinite(h.v.last_seen_s));
    if (!hints.length) continue;
    const first = hints[0]!;
    const votes = hints.filter((h) => h.direction === "with").length;
    const lanes = hints.map((h) => Math.round(finite(h.v.lane_from_median, 1))).sort((a, b) => a - b);
    const hint: LaneHint = {
      direction: votes * 2 >= hints.length ? "with" : "against",
      lane_from_median: clamp(lanes[Math.floor(lanes.length / 2)]!, 1, 6),
      first_seen_s: clamp(Math.min(...hints.map((h) => h.v.first_seen_s)), 0, spec.duration_s),
      last_seen_s: clamp(Math.max(...hints.map((h) => h.v.last_seen_s)), 0, spec.duration_s),
      speed_mps: clamp(hints.reduce((sum, h) => sum + finite(h.v.speed_mps, 0), 0) / hints.length, 0, MAX_SPEED),
      stopped: hints.every((h) => h.v.stopped),
      cameras: [...new Set(hints.map((h) => h.camera))],
    };
    const target = group.matches_object_id ? spec.objects.find((o) => o.id === group.matches_object_id) : undefined;
    if (target) {
      if (target.involvement === "background") target.lane_hint = hint;
      matched++;
      continue;
    }
    if (spec.objects.length >= maxObjects) {
      skipped++;
      continue;
    }
    const category = pick(first.v.category, OBJECT_CATEGORIES, "other");
    const d = CATEGORY_DEFAULTS[category];
    const hex = text(first.v.color_hex);
    const colour = text(first.v.color_name, "grey");
    spec.objects.push({
      id: slug(`${colour}-${category}`, used),
      label: `${colour} ${category}`.trim(),
      category,
      color_name: colour,
      color_hex: /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#8a8f98",
      make: null,
      model: null,
      involvement: "background",
      length_m: d.length,
      width_m: d.width,
      mass_kg: d.mass,
      visible_from_s: hint.first_seen_s,
      visible_to_s: hint.last_seen_s,
      keyframes: [],
      forces: [],
      rest: null,
      confidence: 0.5,
      lane_hint: hint,
    });
    added++;
  }
  return { added, matched, skipped };
}
