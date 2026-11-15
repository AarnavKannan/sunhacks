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
};

export type KinematicsIncident = {
  _id: string;
  title: string;
  hash: string;
  fps: number;
  duration_s: number;
  origin_scene: KinVec3;
  crash: { start_s: number; end_s: number; vehicles: string[] } | null;
  entities: { id: string; label: string; type: string; mass_kg: number; from_s: number; to_s: number; involvement?: "crash" | "background" }[];
  basis: string;
  /** Road and air used for the force breakdown. */
  physics?: { wind: KinVec3; gradePercent: number; surface: string; mu: number; air_density: number };
};

/** A Gemini analysis of uploaded footage (electron/gemini.ts), already validated by gemini/spec.ts. */
export type GeminiAnalysis = { analysisId: string; spec: import("@/gemini/spec").IncidentSpec; cached: boolean; models: string[] };

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
