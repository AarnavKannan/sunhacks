export type StagedVideo = {
  fileName: string;
  sizeBytes: number;
  sha256: string;
};

export type StagedIncident = {
  incidentId: string;
  videos: StagedVideo[];
};

/** Provider health as reported by the assistant package (see packages/assistant/src/providers/types.ts). */
export type AssistantProviderHealth = {
  kind: string;
  installed: boolean;
  version?: string;
  auth: "authenticated" | "unauthenticated" | "unknown";
  authDetail?: string;
  hint?: string;
  usable: boolean;
};

export type AssistantEffort = "low" | "medium" | "high";

/** Which provider, model and effort the assistant is using. Empty model/effort = the provider's default. */
export type AssistantChoice = { provider: string; model?: string; effort?: AssistantEffort };

export type AssistantBridgeEvent = {
  turn: number;
  /** A SessionEvent from the assistant package, or a bridge-level error. */
  event: { type: string; source?: string; [key: string]: unknown };
};

export type KinVec3 = [number, number, number];

/** One object at one moment, as stored in MongoDB (see electron/kinematics.ts). World frame, SI units. */
export type KinematicsFrame = {
  incident_id: string;
  entity_id: string;
  t: number;
  frame: number;
  position: KinVec3;
  velocity: KinVec3;
  speed: number;
  accel: KinVec3;
  accel_long: number;
  heading_deg: number;
  yaw_rate_dps: number;
  mass_kg: number;
  force_net: KinVec3;
  /**
   * The net force split by source (N, world frame): what the road applies through the tyres
   * (braking, accelerating, steering), air drag, rolling resistance, the slope, and, during the
   * crash period, the impact. They sum to force_net.
   */
  force_parts?: { tyre_road: KinVec3; drag: KinVec3; rolling: KinVec3; grade: KinVec3; contact: KinVec3 };
  /** Gemini's own reading of the force from the footage, when it gave one near this time. */
  force_reported?: { vector: KinVec3; cause: string; note: string } | null;
  /** Precision tier: "crash" (precise) or "background" (approximate). */
  involvement?: "crash" | "background";
  sigma: { position_m?: number; speed_mps?: number; accel_mps2?: number } | null;
  /** Compass bearing the body faces (from the played-back pose); heading_deg is the direction of travel. */
  body_heading_deg?: number;
  /** "vehicle" (default when absent) or "static": a fixed object, zero velocity/acceleration/net force. */
  entity_kind?: "vehicle" | "static";
  /**
   * Provenance of this sample's position (measured reconstructions): the spec keyframe's `src`
   * when a keyframe falls on this frame, "interpolated" between keyframes, "static" for fixed
   * objects, absent for preview/model scenes.
   */
  src?: KinSampleSource;
  /** Ids of the objects this entity is in contact with at this frame (from the spec's contacts). */
  contact_with?: string[];
};

/** gemini/spec.ts SampleSource plus "static" (fixed scene object). */
export type KinSampleSource = "measured" | "interpolated" | "occluded-rest" | "out-of-view-extrapolated" | "edge-extrapolated" | "static";

/** A fixed collision object (e.g. the median divider), world frame. Immovable: never has velocity. */
export type KinStaticObject = {
  id: string;
  label: string;
  /** spec StaticObject.kind, e.g. "median_divider". */
  kind: string;
  material: string;
  /** Ground footprint polygon, world frame (y = 0), same order as the spec's plan footprint. */
  footprint: KinVec3[];
  /** Footprint centroid, world frame (y = 0); this is the "position" stored in its frames. */
  centroid: KinVec3;
  /** Unit vector along the footprint's long axis, world frame. */
  axis: KinVec3;
  length_m: number;
  width_m: number;
  height_m: number;
  friction: number;
  restitution: number;
  stiffness_n_per_m: number;
  immovable: true;
  source: "measured" | "inferred";
  sigma_m: number;
  note: string;
};

/** One contact between two objects, world frame. Normal and impulse act from `a` onto `b`. */
export type KinContact = {
  a: string;
  b: string;
  kind: "vehicle-vehicle" | "vehicle-static";
  /** Source video frame index of first contact (t = frame / fps); null when the spec gave none. */
  frame: number | null;
  t: number;
  point: KinVec3;
  /** Unit contact normal from a to b, world frame. */
  normal: KinVec3;
  /** The spec's plan-frame normal (degrees, x along the road, y to its left), for reference. */
  normal_deg_plan: number;
  /** Impulse magnitude along the normal (N·s), as given by the spec; null if not given. */
  impulse_ns: number | null;
  /** Impulse vector on b from a (N·s, world frame) = impulse_ns × normal; null if not given. */
  impulse: KinVec3 | null;
  /**
   * What the stored vectors imply: each moving participant's mass × change in velocity across the
   * contact (velocity just before vs just after, `window_s` apart), world frame. Compare with
   * `impulse` (on b) / -`impulse` (on a). Static objects never move, so they have no entry.
   */
  derived: { entity_id: string; mass_kg: number; delta_v: KinVec3; impulse: KinVec3; along_normal_ns: number; window_s: number }[];
  source: "measured" | "inferred";
  sigma_s?: number;
  note?: string;
};

export type KinematicsIncident = {
  _id: string;
  title: string;
  hash: string;
  fps: number;
  duration_s: number;
  origin_scene: KinVec3;
  crash: { start_s: number; end_s: number; vehicles: string[] } | null;
  entities: {
    id: string;
    label: string;
    type: string;
    mass_kg: number;
    from_s: number;
    to_s: number;
    involvement?: "crash" | "background";
    /** "static" for fixed objects (see static_objects); absent = vehicle. */
    kind?: "vehicle" | "static";
  }[];
  basis: string;
  caveats?: string[];
  /** Road and air used for the force breakdown. */
  physics?: { wind: KinVec3; gradePercent: number; surface: string; mu: number; air_density: number };
  /**
   * What these frames were derived from: derivation version + source version, e.g.
   * "kin-v3|measured-a9-v2#1a2b3c4d5e6f". Part of `hash`, so a new source re-stores the frames.
   */
  version?: string;
  /**
   * Frame grid the samples sit on. "video": sample `frame` is the source video frame index and
   * t = frame / fps exactly (frames first_frame..last_frame). "preview": a synthetic 30 fps grid.
   */
  frame_grid?: { fps: number; first_frame: number; last_frame: number; source: "video" | "preview" };
  /** Fixed collision objects (zero motion), stored as entities of kind "static" too. */
  static_objects?: KinStaticObject[];
  /** Every contact (vehicle-vehicle and vehicle-static) with normals and impulses. */
  contacts?: KinContact[];
};

/** A Gemini analysis of uploaded footage (electron/gemini.ts), already validated by gemini/spec.ts. */
export type GeminiAnalysis = {
  analysisId: string;
  spec: import("@/gemini/spec").IncidentSpec;
  cached: boolean;
  models: string[];
  /** Set when the upload matched known footage and loaded its stored reconstruction instead of a model run. */
  known?: { label: string; version: string };
};

/** A Gemini scene saved in MongoDB: rebuilt from its analysis and seed at startup. */
export type GeminiSceneRecord = {
  sceneId: string;
  analysisId: string;
  seed: number;
  created: string;
  title: string;
  report?: unknown;
};

export type GeminiProgress = { stage: string; detail?: string };

export type SceneCallMessage = { id: number; method: string; args: unknown[] };
export type SceneResultMessage = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

declare global {
  interface Window {
    reconstruct?: {
      isDesktop: boolean;
      stageVideos: (files: File[]) => Promise<StagedIncident>;
      assistant: {
        providers: (refresh?: boolean) => Promise<AssistantProviderHealth[]>;
        choice: () => Promise<AssistantChoice>;
        /** Switch provider, model or effort. Pass "" for model/effort to use the provider default. */
        start: (opts: { provider?: string; model?: string; effort?: AssistantEffort | "" }) => Promise<AssistantChoice>;
        send: (text: string) => Promise<{ turn: number }>;
        interrupt: () => Promise<void>;
        onEvent: (callback: (payload: AssistantBridgeEvent) => void) => () => void;
      };
      scene: {
        onCall: (callback: (message: SceneCallMessage) => void) => () => void;
        reply: (message: SceneResultMessage) => void;
      };
      kinematics: {
        status: () => Promise<{ state: "starting" | "ready" | "error"; mode?: "embedded" | "external"; error?: string }>;
        sync: (meta: KinematicsIncident, frames: KinematicsFrame[]) => Promise<{ synced: boolean; frames: number }>;
        incident: (incidentId: string) => Promise<KinematicsIncident & { synced_at: Date }>;
        sample: (incidentId: string, entityId: string, times: number[]) => Promise<(KinematicsFrame | null)[]>;
        positions: (incidentId: string, t: number) => Promise<{ entity_id: string; position: KinVec3 }[]>;
      };
      /** Footage → scene description via the Gemini API (key stays in the main process). */
      gemini: {
        status: () => Promise<{ configured: boolean; models: { fast: string; precise: string } }>;
        analyze: (files: File[], opts?: { refresh?: boolean; durations?: (number | null)[] }) => Promise<GeminiAnalysis>;
        saveScene: (record: GeminiSceneRecord) => Promise<void>;
        listScenes: () => Promise<(GeminiSceneRecord & { spec: import("@/gemini/spec").IncidentSpec })[]>;
        onProgress: (callback: (progress: GeminiProgress) => void) => () => void;
      };
      /** Resolves to the saved path, or null if the user cancelled the save dialog. */
      saveExport: (bytes: Uint8Array, fileName: string) => Promise<string | null>;
      voice: {
        invoke: (method: string, ...args: unknown[]) => Promise<unknown>;
        on: (callback: (payload: unknown) => void) => () => void;
      };
    };
  }
}

export {};
