/** Authenticated Codex vision ? structured incident ? existing scene engine.
 * Legacy gemini IPC names stay compatible with saved scenes and the renderer.
 */
import { footageDuration, generateVision, visionPreflight as preflight, VISION_MODEL, type VisionPart } from "./codex-vision";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, extname, join } from "node:path";
import type { BrowserWindow, IpcMain } from "electron";
import type { Collection, Db } from "mongodb";
import { cropTile, detectGrid, ffmpegAvailable, type Tile } from "./split-grid";
import {
  ENVIRONMENT_PRESET_NAMES,
  PASS1_SCHEMA,
  PASS2_SCHEMA,
  SCAN_SCHEMA,
  VERIFY_SCHEMA,
  CENSUS_SCHEMA,
  MERGE_SCHEMA,
  applyCensus,
  type CensusVehicle,
  type ScanEvent,
  PROMPT_VERSION,
  sanitizeSpec,
  type IncidentSpec,
} from "../src/gemini/spec";
// The skill: SKILL.md is Codex's system instruction, pass1.md / pass2.md the per-pass tasks.
// Bundled as text by esbuild (--loader:.md=text); edit them, then `npm run build:assistant`.
import SKILL_MD from "./gemini-skill/SKILL.md";
import PASS1_MD from "./gemini-skill/pass1.md";
import PASS2_MD from "./gemini-skill/pass2.md";
import SCAN_MD from "./gemini-skill/scan.md";
import VERIFY_MD from "./gemini-skill/verify.md";
import CENSUS_MD from "./gemini-skill/census.md";
import MERGE_MD from "./gemini-skill/merge.md";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".webm": "video/webm",
};
const modelLists = () => ({ fast: [VISION_MODEL], precise: [VISION_MODEL] });
const models = () => ({ fast: VISION_MODEL, precise: VISION_MODEL });
type FileHandle = { uri: string; mimeType: string; duration: number };
type AnalysisDoc = {
  _id: string;
  /** Each view sent to Codex; a camera cropped from a grid records its source file and crop box. */
  videos: { name: string; sha256: string; duration_s: number | null; tile?: Video["tile"] }[];
  prompt_version: string;
  models: { fast: string; precise: string };
  /** What the incident scan saw, per camera, with confidence. */
  scan: ScanEvent[];
  /** Every vehicle each camera saw, and how they were merged across cameras. */
  census: { camera: string; videoIndex: number; vehicles: CensusVehicle[] }[];
  merge: { entries: string[]; matches_object_id: string | null }[];
  pass1: unknown;
  pass2: unknown;
  spec: IncidentSpec;
  /** Known footage only: version of the spec file stored here (prompt_version#sha256-prefix). */
  spec_version?: string;
  usage: unknown[];
  created_at: Date;
};
type SceneDoc = { _id: string; analysisId: string; seed: number; created: string; title: string; report?: unknown; updated_at: Date };

type Video = {
  path: string;
  name: string;
  sha256: string;
  mimeType: string;
  bytes: Buffer;
  duration: number | null;
  /** Set when this clip is one camera cropped out of a grid video. */
  tile?: { source: string; sourceSha: string; label: string; crop: Tile["crop"] };
};

type Tuning = { mediaResolution: string; thinking?: "low" | "medium" | "high" };
async function generate(_models: string[], parts: unknown[], schema: unknown, _tuning: Tuning, onStatus?: (detail: string) => void) {
  return generateVision(parts as VisionPart[], schema, SKILL_MD, onStatus);
}

/** Fills {{name}} slots in a skill template. */
function render(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? "");
}

function scanSummary(events: ScanEvent[]) {
  if (!events.length) return "The incident scan found nothing unusual in any camera.";
  return events
    .map((e) => `- ${e.t_s.toFixed(1)} s, ${e.camera}: ${e.kind} (${Math.round(e.confidence * 100)}% sure) — ${e.vehicles}${e.lane ? `, ${e.lane}` : ""}. ${e.description}`)
    .join("\n");
}

function pass1Prompt(videos: Video[], events: ScanEvent[]) {
  return render(PASS1_MD, {
    scan: scanSummary(events),
    video_count: `${videos.length} video${videos.length > 1 ? "s" : ""}`,
    video_list: videos
      .map((v, i) => {
        const length = v.duration ? `, ${v.duration.toFixed(2)} s long` : "";
        const sameClock = v.tile && v.tile.sourceSha === (videos[0].tile?.sourceSha ?? videos[0].sha256);
        const tile = v.tile
          ? ` (the ${v.tile.label} camera, cropped from the camera grid ${v.tile.source}; it shares that file's clock${sameClock ? ", so its time_offset_s is 0" : ""})`
          : "";
        return `- Video ${i + 1}: ${v.name}${length}${tile}`;
      })
      .join("\n"),
    presets: ENVIRONMENT_PRESET_NAMES.join(", "),
  });
}

function pass2Prompt(spec: IncidentSpec, from: number, to: number, events: ScanEvent[]) {
  const crash = spec.crash!;
  const participants = spec.objects
    .filter((o) => crash.participants.includes(o.id))
    .map((o) => ({ id: o.id, label: o.label, category: o.category, length_m: o.length_m, width_m: o.width_m, mass_kg: o.mass_kg, keyframes: o.keyframes }));
  return render(PASS2_MD, {
    scan: scanSummary(events),
    pass1: JSON.stringify({ road: spec.road, crash: { start_s: crash.start_s, end_s: crash.end_s, kind: crash.kind, description: crash.description }, participants }),
    from: from.toFixed(2),
    to: to.toFixed(2),
  });
}

/** Pass 2 sometimes answers with clip-relative times; shift them back onto the full timeline. */
function fixClipTimes(pass2: any, from: number) {
  if (!pass2 || from < 1) return pass2;
  const times: number[] = [];
  for (const p of pass2.participants ?? []) for (const k of p.keyframes ?? []) if (typeof k.t_s === "number") times.push(k.t_s);
  if (!times.length) return pass2;
  times.sort((a, b) => a - b);
  if (times[Math.floor(times.length / 2)] >= from - 0.5) return pass2;
  const shift = (o: any) => {
    if (o && typeof o.t_s === "number") o.t_s += from;
  };
  for (const p of pass2.participants ?? []) {
    (p.keyframes ?? []).forEach(shift);
    (p.forces ?? []).forEach(shift);
  }
  (pass2.contacts ?? []).forEach(shift);
  if (typeof pass2.start_s === "number" && pass2.start_s < from - 0.5) pass2.start_s += from;
  if (typeof pass2.end_s === "number" && pass2.end_s < from - 0.5) pass2.end_s += from;
  return pass2;
}

/**
 * Known footage: the demo clip (A9 gantry cameras, 2x2 grid). Its reconstruction is measured
 * frame by frame from the source (electron/demo-incident/incident-spec.json, regenerated by
 * build-measured-spec.py), so uploading it loads that spec instead of asking Codex. Any other
 * footage still goes through the Codex vision passes below.
 *
 * SHA-256 of the exact files (checked against the repo copies): demo.mp4 (59.92 s, 2x2 mosaic;
 * same bytes as TestData/r05_s03_labels_visualization.mp4) and demo_32s.mp4 (its first 400 frames,
 * 0-399 at 12.5 fps). Both load the same spec.
 */
const DEMO_SHA256S = new Set([
  "a02fe07d46091bbde14d9c58a16d94680f18d15ad48b3f316d25e03c3938e54a",
  "62b6153f1839133d062d9f3425ebf93aae85250b8e854bdbd3eabbbfbe8dd16e",
]);
/**
 * Storage key of the demo's analysis. Deliberately stable (the saved library scene is
 * "gemini-" + its first 12 characters), so a regenerated spec replaces the demo in place instead of
 * adding a second copy. The content version lives in `spec_version`. The name is historical.
 */
const DEMO_ANALYSIS_ID = "demo-a9-verified-v1";
/** Analysis ids that hold the demo (older builds may have used others); they always reload the file. */
const isDemoAnalysis = (analysis: AnalysisDoc) =>
  analysis._id === DEMO_ANALYSIS_ID || analysis._id.startsWith("demo-a9-") ||
  (analysis.videos.length > 0 && analysis.videos.every((v) => DEMO_SHA256S.has(v.tile?.sourceSha ?? v.sha256)));
/** Read from disk on every use (not bundled), so the scene data can be regenerated without a rebuild. */
const DEMO_SPEC_PATH = join(__dirname, "demo-incident", "incident-spec.json");

type DemoSpec = {
  spec: IncidentSpec;
  /** prompt_version + "#" + first 12 hex of the file's SHA-256: changes whenever the file does. */
  version: string;
  /** What produced it, for the UI ("measured" for calibrated per-frame tracks; never "verified" for those). */
  label: string;
};

/** Label for how the demo spec was made, from its prompt_version. */
export function demoLabel(promptVersion: string) {
  if (/measured/i.test(promptVersion)) return "measured";
  if (/^hand-verified/i.test(promptVersion)) return "hand-annotated";
  return promptVersion || "stored";
}

export async function loadDemoSpec(path = DEMO_SPEC_PATH): Promise<DemoSpec> {
  let raw: Buffer;
  let spec: IncidentSpec;
  try {
    raw = await fs.readFile(path);
    spec = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new Error(`Couldn't read the demo reconstruction at ${path} (${error instanceof Error ? error.message : String(error)}).`);
  }
  if (!spec || !Array.isArray(spec.objects) || !(spec.duration_s > 0) || !spec.road) {
    throw new Error(`The demo reconstruction at ${path} isn't a valid incident spec.`);
  }
  const sha = createHash("sha256").update(raw).digest("hex");
  const promptVersion = typeof spec.prompt_version === "string" && spec.prompt_version ? spec.prompt_version : "demo";
  return { spec, version: `${promptVersion}#${sha.slice(0, 12)}`, label: demoLabel(promptVersion) };
}

/** Stores (or refreshes) the demo's analysis document with the given spec version. */
async function storeDemoAnalysis(analyses: Collection<AnalysisDoc>, demo: DemoSpec, videos: AnalysisDoc["videos"], id = DEMO_ANALYSIS_ID) {
  await analyses.replaceOne(
    { _id: id },
    {
      videos,
      prompt_version: demo.spec.prompt_version ?? "demo",
      spec_version: demo.version,
      models: { fast: demo.label, precise: demo.label },
      scan: [],
      census: [],
      merge: [],
      pass1: null,
      pass2: null,
      spec: demo.spec,
      usage: [],
      created_at: new Date(),
    },
    { upsert: true },
  );
}

export function registerGemini({
  ipcMain,
  getWindow,
  db,
  cacheDir,
  demoSpecPath = DEMO_SPEC_PATH,
}: {
  ipcMain: IpcMain;
  getWindow: () => BrowserWindow | null;
  db: () => Promise<Db>;
  /** Where cropped camera tiles are kept (userData/gemini-tiles). */
  cacheDir: string;
  /** Alternate fixture path for routing tests; production always reads the on-disk demo spec. */
  demoSpecPath?: string;
}) {
  const progress = (stage: string, detail?: string) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send("gemini:progress", { stage, detail });
  };

  ipcMain.handle("gemini:status", async () => {
    const check = await preflight();
    return { configured: check.ok, models: models(), ...check };
  });

  ipcMain.handle("gemini:analyze", async (_event, paths: string[], opts: { refresh?: boolean; durations?: (number | null)[] } = {}) => {
    if (!Array.isArray(paths) || paths.length === 0) throw new Error("Select at least one video.");
    if (paths.length > 4) throw new Error("Use at most 4 videos per reconstruction.");
    const { fast, precise } = models();
    const database = await db();
    const analyses = database.collection<AnalysisDoc>("analyses");

    progress("Reading footage");
    const videos: Video[] = [];
    for (const [i, path] of paths.entries()) {
      const mimeType = MIME[extname(path).toLowerCase()];
      if (!mimeType) throw new Error(`Unsupported video type: ${basename(path)}`);
      const bytes = await fs.readFile(path);
      if (bytes.length > 1.9e9) throw new Error(`${basename(path)} exceeds the app's 1.9 GB footage limit.`);
      videos.push({
        path,
        name: basename(path),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mimeType,
        bytes,
        duration: Number.isFinite(opts.durations?.[i]) && opts.durations![i]! > 0 ? opts.durations![i]! : await footageDuration(path),
      });
    }
    // The demo clip (1-4 copies of it): load its measured reconstruction from disk. No cache lookup,
    // so an older Codex reading of the same footage (stored under another id) can never come back,
    // and the stored copy is replaced whenever the file's version changes.
    if (videos.every((v) => DEMO_SHA256S.has(v.sha256))) {
      progress("Matched known footage", "This clip has a stored reconstruction; no Codex call needed.");
      const demo = await loadDemoSpec(demoSpecPath);
      progress("Loading the stored reconstruction", `${demo.label} reconstruction ${demo.version} (A9 gantry cameras)…`);
      progress("Saving", "Storing the reconstruction in the database…");
      await storeDemoAnalysis(analyses, demo, videos.map((v) => ({ name: v.name, sha256: v.sha256, duration_s: v.duration })));
      return { analysisId: DEMO_ANALYSIS_ID, spec: demo.spec, cached: false, models: [demo.label], known: { label: demo.label, version: demo.version } };
    }

    const analysisId = createHash("sha256")
      .update([PROMPT_VERSION, "codex-frame-sheets-v2-xhigh", fast, precise, ...videos.map((v) => v.sha256)].join("|"))
      .digest("hex")
      .slice(0, 24);
    if (!opts.refresh) {
      const cached = await analyses.findOne({ _id: analysisId });
      if (cached) {
        progress("Loaded from the database", "This footage was analysed before; no Codex call needed.");
        return { analysisId, spec: cached.spec, cached: true, models: [fast, precise] };
      }
    }

    // Check subscription auth before preparing frames.
    progress("Checking Codex auth", "ChatGPT login…");
    const check = await preflight();
    if (!check.ok) throw new Error(check.error);
    progress("Checking Codex auth", `${check.available.length} model${check.available.length > 1 ? "s" : ""} ready (${check.available.slice(0, 3).join(", ")}${check.available.length > 3 ? ", …" : ""}).`);

    // Camera grids: crop each tile into its own full-resolution clip, so Codex sees every camera properly.
    const notes: string[] = [];
    if (await ffmpegAvailable()) {
      const expanded: Video[] = [];
      for (const video of videos) {
        try {
          progress("Checking for a camera grid", video.name);
          const grid = await detectGrid(video.path, video.duration);
          if (grid.tiles.length < 2) {
            expanded.push(video);
            continue;
          }
          progress("Splitting cameras", `${video.name}: ${grid.tiles.length} views (${grid.tiles.map((t) => t.label).join(", ")})`);
          for (const tile of grid.tiles) {
            const path = await cropTile(video.path, video.sha256, tile, cacheDir);
            const bytes = await fs.readFile(path);
            expanded.push({
              path,
              name: `${basename(video.name, extname(video.name))} [${tile.label}].mp4`,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              mimeType: "video/mp4",
              bytes,
              duration: video.duration,
              tile: { source: video.name, sourceSha: video.sha256, label: tile.label, crop: tile.crop },
            });
          }
          notes.push(`${video.name} is a ${grid.tiles.length}-camera grid; each camera was cropped out and read on its own.`);
        } catch (error) {
          expanded.push(video);
          notes.push(`Couldn't split ${video.name} into cameras (${error instanceof Error ? error.message : String(error)}); it was read whole.`);
        }
      }
      if (expanded.length > 10) throw new Error(`That's ${expanded.length} camera views; Codex reads at most 10 per request. Use fewer videos.`);
      videos.splice(0, videos.length, ...expanded);
    } else {
      throw new Error("Install ffmpeg to extract video frames for Codex vision.");
    }

    const handles: FileHandle[] = videos.map((video) => ({ uri: video.path, mimeType: video.mimeType, duration: video.duration ?? 60 }));
    const usage: unknown[] = [];
    // Every video goes in with its name in front, so answers can say which camera they mean.
    const videoParts = (meta: (i: number) => Record<string, unknown>) =>
      handles.flatMap((h, i) => [
        { text: `Video ${i + 1}: ${videos[i].name}` },
        { fileData: { fileUri: h.uri, mimeType: h.mimeType }, videoMetadata: { duration: h.duration, ...meta(i) } },
      ]);
    const duration = videos[0].duration ?? 60;

    // Step 1: incident scan, one camera at a time (attention on one view finds far more than a
    // grid of four), 20 s windows, 3 frames/s at high resolution. Only "did anything crash-like happen".
    const candidates: ScanEvent[] = [];
    // Whole clip per camera: 4 requests instead of 12 keeps a run inside free-tier daily quotas.
    const WINDOW = Math.max(20, duration + 1);
    for (const [i, h] of handles.entries()) {
      for (let from = 0; from < duration - 0.5; from += WINDOW - 2) {
        const to = Math.min(duration, from + WINDOW);
        progress("Scanning for the crash", `${videos[i].name}, ${from.toFixed(0)}-${to.toFixed(0)} s…`);
        try {
          const scan = await generate(
            modelLists().fast,
            [
              { text: `Video ${i + 1}: ${videos[i].name}` },
              { fileData: { fileUri: h.uri, mimeType: h.mimeType }, videoMetadata: { duration: h.duration, fps: 3, startOffset: `${from.toFixed(2)}s`, endOffset: `${to.toFixed(2)}s` } },
              { text: render(SCAN_MD, { from: from.toFixed(1), to: to.toFixed(1) }) },
            ],
            SCAN_SCHEMA,
            { mediaResolution: "MEDIA_RESOLUTION_HIGH", thinking: "high" },
            (d) => progress("Scanning for the crash", d),
          );
          usage.push(scan.usage);
          for (const e of (scan.json as { events?: ScanEvent[] }).events ?? []) {
            if (typeof e?.t_s !== "number" || typeof e.confidence !== "number") continue;
            // If it answered in clip time, move it onto the full timeline.
            const t = e.t_s < from - 0.5 && from >= 1 ? e.t_s + from : e.t_s;
            const camera = videos[i].name;
            if (candidates.some((x) => x.kind === e.kind && x.camera === camera && Math.abs(x.t_s - t) < 1)) continue;
            candidates.push({ ...e, t_s: t, camera, confidence: Math.min(1, Math.max(0, e.confidence)) });
          }
        } catch (error) {
          notes.push(`The crash scan of ${videos[i].name} ${from.toFixed(0)}-${to.toFixed(0)} s failed (${error instanceof Error ? error.message : String(error)}).`);
        }
      }
    }

    // Step 1b: verify. A one-shot scan can both miss and imagine contacts, so every candidate
    // (a contact, or a spin / debris / stopped vehicle that could be the aftermath of one) gets a
    // close look: that camera only, ±3 s, 10 frames/s. Only confirmed collisions count as a crash.
    const events: ScanEvent[] = candidates.filter((e) => e.kind !== "contact");
    const toCheck = candidates
      .filter((e) => ["contact", "spin", "debris", "stopped_vehicle"].includes(e.kind) && e.confidence >= 0.5)
      .sort((a, b) => (a.kind === "contact" ? 0 : 1) - (b.kind === "contact" ? 0 : 1) || b.confidence - a.confidence);
    const checked: { camera: string; t: number }[] = [];
    for (const candidate of toCheck) {
      if (checked.length >= 5) break;
      if (checked.some((c) => c.camera === candidate.camera && Math.abs(c.t - candidate.t_s) < 5)) continue;
      checked.push({ camera: candidate.camera, t: candidate.t_s });
      const i = videos.findIndex((v) => v.name === candidate.camera);
      if (i < 0) continue;
      const from = Math.max(0, candidate.t_s - (candidate.kind === "contact" ? 3 : 6));
      const to = Math.min(duration, candidate.t_s + 3);
      progress("Checking a possible crash", `${candidate.camera} around ${candidate.t_s.toFixed(1)} s (${candidate.vehicles || candidate.kind})…`);
      try {
        const verdict = await generate(
          modelLists().fast,
          [
            { text: `Video ${i + 1}: ${videos[i].name}` },
            { fileData: { fileUri: handles[i].uri, mimeType: handles[i].mimeType }, videoMetadata: { duration: handles[i].duration, fps: 10, startOffset: `${from.toFixed(2)}s`, endOffset: `${to.toFixed(2)}s` } },
            {
              text: render(VERIFY_MD, {
                from: from.toFixed(1),
                to: to.toFixed(1),
                claim: `${candidate.kind} at about ${candidate.t_s.toFixed(1)} s: ${candidate.vehicles}${candidate.lane ? `, ${candidate.lane}` : ""}. ${candidate.description}`,
              }),
            },
          ],
          VERIFY_SCHEMA,
          { mediaResolution: "MEDIA_RESOLUTION_HIGH", thinking: "high" },
          (d) => progress("Checking a possible crash", d),
        );
        usage.push(verdict.usage);
        const v = verdict.json as { collision?: boolean; first_contact_s?: number; vehicles?: string; lane?: string; description?: string; confidence?: number };
        if (v.collision && typeof v.first_contact_s === "number" && (v.confidence ?? 0) >= 0.6) {
          const t = v.first_contact_s < from - 0.5 && from >= 1 ? v.first_contact_s + from : v.first_contact_s;
          events.push({ t_s: t, camera: candidate.camera, kind: "contact", vehicles: v.vehicles ?? candidate.vehicles, lane: v.lane ?? candidate.lane, description: `Confirmed on a close look. ${v.description ?? ""}`, confidence: Math.min(1, v.confidence ?? 0.6) });
        } else if (candidate.kind === "contact") {
          notes.push(`A possible contact in ${candidate.camera} at ${candidate.t_s.toFixed(1)} s wasn't confirmed on a close look (${v.description ?? "no collision seen"}).`);
        }
      } catch (error) {
        // Unverified: keep the scan's own reading at its own confidence.
        if (candidate.kind === "contact") events.push(candidate);
        notes.push(`Couldn't double-check the possible crash in ${candidate.camera} at ${candidate.t_s.toFixed(1)} s (${error instanceof Error ? error.message : String(error)}).`);
      }
    }
    events.sort((a, b) => a.t_s - b.t_s);

    // Step 2: the whole incident: road, environment, every vehicle, the crash period.
    progress("Pass 1 of 2", `${fast} is reading the whole clip: road, weather, every vehicle, the crash period…`);
    const first = await generate(modelLists().fast, [...videoParts(() => ({ fps: 2 })), { text: pass1Prompt(videos, events) }], PASS1_SCHEMA, { mediaResolution: "MEDIA_RESOLUTION_MEDIUM" }, (d) =>
      progress("Pass 1 of 2", d),
    );
    usage.push(first.usage);
    let spec = sanitizeSpec(first.json);
    if (videos[0].duration) spec.duration_s = videos[0].duration;
    spec.caveats.push(...notes);

    let pass2: unknown = null;
    const contacts = events.filter((e) => e.kind === "contact" && e.confidence >= 0.5);
    if (!spec.crash && contacts.length) {
      notes.push(`The crash scan saw a contact at ${contacts[0].t_s.toFixed(1)} s (${contacts[0].vehicles}), but the full read didn't place it; no crash was reconstructed. Try again with refresh.`);
    }
    if (spec.crash) {
      // Centre the precise pass on the first contact the scan saw, when it agrees with pass 1.
      const seen = contacts.find((c) => Math.abs(c.t_s - spec.crash!.start_s) < 4)?.t_s ?? spec.crash.start_s;
      const from = Math.max(0, Math.min(seen, spec.crash.start_s) - 3);
      const to = Math.min(spec.duration_s, Math.max(spec.crash.end_s, seen + 3) + 1.5);
      progress("Pass 2 of 2", `${precise} is measuring the crash (${from.toFixed(1)}-${to.toFixed(1)} s): positions, forces, contacts…`);
      const parts = handles.map((h, i) => {
        // Cameras cropped from the same file as video 1 share its clock exactly.
        const sameClock = (videos[i].tile?.sourceSha ?? videos[i].sha256) === (videos[0].tile?.sourceSha ?? videos[0].sha256);
        const offset = sameClock ? 0 : (spec.views.find((v) => v.video_index === i + 1)?.time_offset_s ?? 0);
        const start = Math.max(0, from - offset);
        const end = Math.max(start + 1, to - offset);
        return [
          { text: `Video ${i + 1}: ${videos[i].name}` },
          { fileData: { fileUri: h.uri, mimeType: h.mimeType }, videoMetadata: { duration: h.duration, fps: 10, startOffset: `${start.toFixed(2)}s`, endOffset: `${end.toFixed(2)}s` } },
        ];
      }).flat();
      try {
        const second = await generate(modelLists().precise, [...parts, { text: pass2Prompt(spec, from, to, events) }], PASS2_SCHEMA, { mediaResolution: "MEDIA_RESOLUTION_HIGH", thinking: "high" }, (d) =>
          progress("Pass 2 of 2", d),
        );
        usage.push(second.usage);
        pass2 = fixClipTimes(second.json, from);
        spec = sanitizeSpec(first.json, pass2);
        if (videos[0].duration) spec.duration_s = videos[0].duration;
        spec.caveats.push(...notes);
      } catch (error) {
        // The coarse pass still makes a usable scene; say so instead of failing outright.
        spec.caveats.push(`The precise crash pass failed (${error instanceof Error ? error.message : String(error)}); crash motion uses the coarse pass.`);
      }
    }

    // Step 4: census. Every vehicle in every camera, one camera per request so none is cut short,
    // then a cheap text-only request merges the same vehicle seen by several cameras.
    const census: { camera: string; videoIndex: number; vehicles: CensusVehicle[] }[] = [];
    for (const [i, h] of handles.entries()) {
      progress("Counting every vehicle", `${videos[i].name} (${i + 1} of ${handles.length})…`);
      try {
        const result = await generate(
          modelLists().fast,
          [
            { text: `Video ${i + 1}: ${videos[i].name}` },
            { fileData: { fileUri: h.uri, mimeType: h.mimeType }, videoMetadata: { duration: h.duration, fps: 2 } },
            { text: render(CENSUS_MD, { camera: `Video ${i + 1} (${videos[i].name})` }) },
          ],
          CENSUS_SCHEMA,
          { mediaResolution: "MEDIA_RESOLUTION_HIGH" },
          (d) => progress("Counting every vehicle", d),
        );
        usage.push(result.usage);
        const vehicles = ((result.json as { vehicles?: CensusVehicle[] }).vehicles ?? []).filter((v) => v && typeof v.ref === "string");
        census.push({ camera: videos[i].name, videoIndex: i + 1, vehicles });
      } catch (error) {
        notes.push(`The vehicle count for ${videos[i].name} failed (${error instanceof Error ? error.message : String(error)}).`);
      }
    }
    const censusTotal = census.reduce((sum, c) => sum + c.vehicles.length, 0);
    let groups: { entries: string[]; matches_object_id: string | null }[] = [];
    if (censusTotal) {
      progress("Merging cameras", `${censusTotal} sightings across ${census.length} cameras…`);
      try {
        const compact = census.flatMap((c) =>
          c.vehicles.map((v) => ({
            key: `${c.videoIndex}:${v.ref}`,
            category: v.category,
            color: v.color_name,
            toward_camera: v.toward_camera,
            lane: v.lane_from_median,
            seen: [v.first_seen_s, v.last_seen_s],
            speed: v.speed_mps,
            stopped: v.stopped,
          })),
        );
        const merged = await generate(
          modelLists().fast,
          [
            {
              text: render(MERGE_MD, {
                views: spec.views.map((v) => `- Video ${v.video_index}: ${v.description} (+x traffic: ${v.plus_x_traffic})`).join("\n"),
                objects: JSON.stringify(spec.objects.map((o) => ({ id: o.id, label: o.label, category: o.category, involvement: o.involvement, seen: [o.visible_from_s, o.visible_to_s] }))),
                census: JSON.stringify(compact),
              }),
            },
          ],
          MERGE_SCHEMA,
          { mediaResolution: "MEDIA_RESOLUTION_LOW" },
          (d) => progress("Merging cameras", d),
        );
        usage.push(merged.usage);
        groups = ((merged.json as { groups?: typeof groups }).groups ?? []).filter((g) => Array.isArray(g?.entries));
      } catch (error) {
        notes.push(`Merging the cameras' vehicle lists failed (${error instanceof Error ? error.message : String(error)}); each sighting is drawn as its own vehicle.`);
      }
      const result = applyCensus(spec, census, groups);
      notes.push(
        `Vehicle census: ${censusTotal} sightings across ${census.length} cameras became ${result.added} added vehicles and ${result.matched} matches to the main read${result.skipped ? `; ${result.skipped} left out over the 150-vehicle limit` : ""}.`,
      );
    }
    spec.caveats.push(...notes.filter((n) => !spec.caveats.includes(n)));

    progress("Saving", "Storing Codex's reading in the database…");
    await analyses.replaceOne(
      { _id: analysisId },
      {
        videos: videos.map((v) => ({ name: v.name, sha256: v.sha256, duration_s: v.duration, ...(v.tile ? { tile: v.tile } : {}) })),
        prompt_version: PROMPT_VERSION,
        models: { fast, precise },
        scan: events,
        census,
        merge: groups,
        pass1: first.json,
        pass2,
        spec,
        usage,
        created_at: new Date(),
      },
      { upsert: true },
    );
    // The models that actually answered (after any fallback).
    const used = [...new Set(usage.map((u) => (u as { model: string }).model))];
    return { analysisId, spec, cached: false, models: used };
  });

  ipcMain.handle("gemini:save-scene", async (_event, record: Omit<SceneDoc, "_id" | "updated_at"> & { sceneId: string }) => {
    const { sceneId, ...rest } = record;
    await (await db()).collection<SceneDoc>("scenes").replaceOne({ _id: sceneId }, { ...rest, updated_at: new Date() }, { upsert: true });
  });

  ipcMain.handle("gemini:list-scenes", async () => {
    const database = await db();
    const scenes = await database.collection<SceneDoc>("scenes").find({}).sort({ updated_at: -1 }).toArray();
    const out = [];
    for (const scene of scenes) {
      const analysis = await database.collection<AnalysisDoc>("analyses").findOne({ _id: scene.analysisId });
      if (!analysis) continue;
      let spec = analysis.spec;
      // The demo scene always rebuilds from the current file on disk, and the stored analysis is
      // brought up to that version, so neither the scene nor its kinematics can come back stale.
      const demoScene = isDemoAnalysis(analysis);
      if (demoScene) {
        try {
          const demo = await loadDemoSpec(demoSpecPath);
          spec = demo.spec;
          if (analysis.spec_version !== demo.version) await storeDemoAnalysis(database.collection<AnalysisDoc>("analyses"), demo, analysis.videos, scene.analysisId);
        } catch (error) {
          // Keep the library usable, but say plainly that this is the last stored copy.
          console.error("Demo reconstruction file unreadable; using the stored copy", error);
          spec = {
            ...analysis.spec,
            caveats: [
              ...(analysis.spec.caveats ?? []),
              `The current demo reconstruction file couldn't be read (${error instanceof Error ? error.message : String(error)}); this is the stored copy${analysis.spec_version ? ` (${analysis.spec_version})` : ""}.`,
            ],
          };
        }
      }
      // Demo reports are rebuilt with the current spec in the renderer; never return an old report.
      out.push({ sceneId: scene._id, analysisId: scene.analysisId, seed: scene.seed, created: scene.created, title: demoScene ? spec.title : scene.title, report: demoScene ? undefined : scene.report, spec });
    }
    return out;
  });
}
