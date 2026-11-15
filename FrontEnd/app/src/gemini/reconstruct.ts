/**
 * Renderer side of a Codex reconstruction: footage → Gemini (main process) → engine → library + MongoDB.
 */
import type { SceneInfo } from "@/data/scenes";
import { buildGeminiScene } from "@/gemini/engine";
import type { IncidentSpec } from "@/gemini/spec";
import { ensureKinematics, forgetKinematics } from "@/kinematics/store";
import { useAppStore, type UploadItem } from "@/store/useAppStore";

function api() {
  const gemini = window.reconstruct?.gemini;
  if (!gemini) throw new Error("Codex reconstruction runs in the desktop app.");
  return gemini;
}

const clean = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error);

/** Length of a local video in seconds, read by the browser (null if it can't tell). */
function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

const newSeed = () => (Math.random() * 2 ** 31) >>> 0;

function build(sceneId: string, spec: IncidentSpec, seed: number, created: string, sourceVideo?: SceneInfo["sourceVideo"]) {
  const built = buildGeminiScene({ id: sceneId, spec, seed, created, sourceVideo });
  forgetKinematics(sceneId);
  useAppStore.getState().upsertScene(built.scene);
  return built;
}

/** Sends the queued videos (one incident, up to 4 views) to Gemini and opens the result. */
export async function reconstructWithGemini(uploads: UploadItem[], opts: { refresh?: boolean } = {}) {
  const store = useAppStore.getState();
  const videos = uploads.filter((upload) => upload.file.type.startsWith("video/") || /\.(mp4|mov|m4v|mkv|avi|webm)$/i.test(upload.name));
  if (videos.length === 0) {
    store.setGeminiJob({ state: "error", error: "Queue at least one video first." });
    return;
  }
  const off = api().onProgress((progress) =>
    useAppStore.getState().setGeminiJob({ state: "running", stage: progress.stage, detail: progress.detail }),
  );
  store.setGeminiJob({ state: "running", stage: "Starting", detail: "Preparing the footage…" });
  try {
    const durations = await Promise.all(videos.map((upload) => videoDuration(upload.file)));
    const analysis = await api().analyze(
      videos.map((upload) => upload.file),
      { ...opts, durations },
    );
    useAppStore.getState().setGeminiJob({ state: "running", stage: "Building the scene", detail: "Running the physics engine…" });
    const sceneId = `gemini-${analysis.analysisId.slice(0, 12)}`;
    const seed = newSeed();
    const created = new Date().toISOString().slice(0, 10);
    const sourceVideo = { url: URL.createObjectURL(videos[0].file), name: videos[0].name };
    const built = build(sceneId, analysis.spec, seed, created, sourceVideo);
    await api().saveScene({ sceneId, analysisId: analysis.analysisId, seed, created, title: built.scene.title, report: built.report });
    useAppStore.getState().setGeminiJob({ state: "running", stage: "Saving motion data", detail: "Storing per-frame kinematics and forces…" });
    await ensureKinematics(built.scene);
    const removed = built.report.removed.length ? ` ${built.report.removed.length} object(s) left out.` : "";
    useAppStore.getState().setGeminiJob({
      state: "done",
      sceneId,
      message: `${analysis.cached ? "Loaded the stored Codex reading" : analysis.models.includes("hand-verified") ? "Loaded the hand-verified reconstruction" : `Read by ${analysis.models.join(" + ")}`}: ${built.scene.vehicles.length} vehicles.${removed}`,
    });
    useAppStore.getState().openScene(sceneId);
  } catch (error) {
    useAppStore.getState().setGeminiJob({ state: "error", error: clean(error) });
  } finally {
    off();
  }
}

/** At startup: rebuilds every Gemini scene saved in MongoDB and puts it back in the library. */
export async function loadSavedGeminiScenes() {
  const gemini = window.reconstruct?.gemini;
  if (!gemini) return;
  try {
    const saved = await gemini.listScenes();
    for (const record of saved.reverse()) {
      try {
        const built = build(record.sceneId, record.spec, record.seed, record.created);
        await ensureKinematics(built.scene);
      } catch (error) {
        console.error(`Couldn't rebuild Gemini scene ${record.sceneId}`, error);
      }
    }
  } catch (error) {
    console.error("Couldn't load saved Gemini scenes", error);
  }
}
