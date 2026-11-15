/**
 * Renderer access to the kinematics database. The data lives in MongoDB in the main process;
 * this module makes sure each scene's frames are stored (once per content change) and reads them
 * back for the assistant's tools and the panel.
 *
 * Staleness: the stored incident carries a content hash of everything derived (which includes
 * the derivation version and the source spec's prompt_version + content hash), so a regenerated
 * spec or a changed derivation always re-stores the rows; an unchanged one is a no-op.
 */
import { BUILTIN_SCENES, type SceneInfo } from "@/data/scenes";
import type { KinematicsFrame, KinematicsIncident } from "@/electron.d";
import type { IncidentSpec } from "@/gemini/spec";
import { deriveSceneKinematics, registerSceneSpec } from "@/kinematics/derive";

/** Scene id → the current sync job (deriving + storing). */
const syncs = new Map<string, Promise<boolean>>();
/** Scene id → the last job started, finished or not (so a rebuild never overlaps an earlier store). */
const pending = new Map<string, Promise<boolean>>();
/** Scene id → hash last stored by this session. */
const stored = new Map<string, string>();

function api() {
  const kinematics = window.reconstruct?.kinematics;
  if (!kinematics) throw new Error("Motion data is stored in the desktop app's database; it isn't available in a plain browser.");
  return kinematics;
}

const clean = (error: unknown) =>
  new Error(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error));

/** Stores a scene's frames if the database doesn't have this exact version. Resolves false when the scene has none. */
export function ensureKinematics(scene: SceneInfo): Promise<boolean> {
  const existing = syncs.get(scene.id);
  if (existing) return existing;
  // Wait for any earlier job for this scene (a rebuild while it was storing), then store ours.
  const before = pending.get(scene.id) ?? Promise.resolve();
  const job = before
    .catch(() => undefined)
    .then(async () => {
      const derived = deriveSceneKinematics(scene);
      if (!derived) return false;
      if (stored.get(scene.id) === derived.meta.hash) return true;
      await api().sync(derived.meta, derived.frames);
      stored.set(scene.id, derived.meta.hash);
      return true;
    });
  job.catch(() => {
    if (syncs.get(scene.id) === job) syncs.delete(scene.id);
  });
  syncs.set(scene.id, job);
  pending.set(scene.id, job);
  void job
    .catch(() => undefined)
    .then(() => {
      if (pending.get(scene.id) === job) pending.delete(scene.id);
    });
  return job;
}
/**
 * Call after a reconstruction scene is (re)built: remembers the spec it came from (provenance,
 * static objects, contacts, frame grid) and makes the next read store the new frames.
 */
export function rememberSceneSource(sceneId: string, spec: IncidentSpec) {
  registerSceneSpec(sceneId, spec);
  forgetKinematics(sceneId);
}

/** Drops the remembered sync for a scene (after it was rebuilt), so the next read stores the new frames. */
export function forgetKinematics(sceneId: string) {
  syncs.delete(sceneId);
}

/** Called once at startup in the desktop app: loads every built-in scene into the database. */
export async function syncBuiltinScenes() {
  if (!window.reconstruct?.kinematics) return;
  for (const scene of BUILTIN_SCENES) {
    try {
      await ensureKinematics(scene);
    } catch (error) {
      console.error(`Couldn't store motion data for ${scene.id}`, error);
    }
  }
}

export async function incidentMeta(scene: SceneInfo): Promise<KinematicsIncident> {
  if (!(await ensureKinematics(scene).catch((error) => Promise.reject(clean(error))))) {
    throw new Error("This reconstruction has no per-frame motion data yet.");
  }
  return api().incident(scene.id).catch((error) => Promise.reject(clean(error)));
}

export async function sampleKinematics(scene: SceneInfo, entityId: string, times: number[]): Promise<(KinematicsFrame | null)[]> {
  await incidentMeta(scene);
  return api().sample(scene.id, entityId, times).catch((error) => Promise.reject(clean(error)));
}
