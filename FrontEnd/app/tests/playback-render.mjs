// From FrontEnd/app: node tests/playback-render.mjs [demo|fixture|spec.json ...]
// Linux, no Electron: own agent-browser session + temporary Vite server on a free port >=5199.
// Requires ffmpeg and agent-browser. Source-camera comparisons require <spec>.build.json
// with X_REF/Y_median from the builder. Without it, saves explicitly labelled overview comparisons.
// --require-source fails if any mapping is absent; --overview-only skips source-camera captures.
// Stops its browser/server even on failure and checkpoints partial results after each frame.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createViteServer } from "vite";
import { copyFileSync, writeFileSync, existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const video = path.resolve(app, "../../demo_32s.mp4");
const SPECS = { demo: "electron/demo-incident/incident-spec.json", fallback: "electron/demo-incident/incident-spec.json", fixture: "electron/demo-incident/measure/review_spec/incident-spec.json" };
// Exact source frames, including the complete verge/contact uncertainty windows.
const defaultFrames = [0, 125, 188, 212, 213, 250, ...Array.from({ length: 14 }, (_, i) => 281 + i), 300, 350, 399];
const framesFlag = process.argv.find((s) => s.startsWith("--frames="));
const FRAMES = [...new Set(framesFlag ? framesFlag.slice(9).split(",").map(Number) : defaultFrames)].sort((a, b) => a - b);
if (!FRAMES.length || FRAMES.some((f) => !Number.isInteger(f) || f < 0 || f > 399)) throw new Error("--frames must list source frames 0..399");
const outputFlag = process.argv.find((s) => s.startsWith("--out="));
const output = outputFlag ? path.resolve(app, outputFlag.slice(6)) : here;
mkdirSync(output, { recursive: true });
const resume = process.argv.includes("--resume");
const requiredFrames = process.argv.includes("--all-checkpoints") ? defaultFrames : FRAMES;
const W = 958, H = 600;
const requireSource = process.argv.includes("--require-source");
const overviewOnly = process.argv.includes("--overview-only");
const args = process.argv.slice(2).filter((s) => !["--require-source", "--overview-only", "--resume", "--all-checkpoints"].includes(s) && !s.startsWith("--frames=") && !s.startsWith("--out="));
const want = args.length ? args : ["demo", "fixture"];
const scratch = mkdtempSync(path.join(os.tmpdir(), "w4-playback-render-"));
const session = `w4-playback-${process.pid}`;
const browserEnv = { ...process.env, AGENT_BROWSER_SESSION: session, AGENT_BROWSER_ARGS: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"].join("\n") };
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const run = (cmd, argv, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(cmd, argv, { cwd: app, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  const deadline = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${cmd} ${argv[0]} timed out`)); }, 50000);
  child.on("error", (e) => { clearTimeout(deadline); reject(e); });
  child.on("close", (code) => { clearTimeout(deadline); code === 0 ? resolve(stdout) : reject(new Error(`${cmd} ${argv[0]} exited ${code}: ${stderr || stdout}`)); });
});
const agent = async (...argv) => {
  const raw = await run("agent-browser", ["--json", ...argv], browserEnv);
  const result = JSON.parse(raw);
  if (!result.success) throw new Error(JSON.stringify(result.error ?? result));
  return result.data;
};
const evaluate = async (expression) => (await agent("eval", "-b", Buffer.from(expression).toString("base64"))).result;
const freePort = (start) => new Promise((resolve) => {
  const s = createServer();
  s.once("error", () => resolve(freePort(start + 1)));
  s.listen(start, "127.0.0.1", () => s.close(() => resolve(start)));
});
const ffmpeg = (argv) => execFileSync("ffmpeg", ["-y", "-v", "error", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1", ...argv], { stdio: "pipe", timeout: 30000 });

let vite;
const statusPath = path.join(output, "playback-render-status.json");
const codeHashes = Object.fromEntries(["tests/playback-render.mjs", "tests/render/viewer.ts", "tests/render/source-camera.ts", "src/scene/mountScene.ts", "src/gemini/engine.ts", "src/gemini/motion.ts", "src/scene/cars.ts"].map((p) => [p, sha(path.join(app, p))]));
const status = resume && existsSync(statusPath) ? JSON.parse(readFileSync(statusPath, "utf8"))
  : { generated: new Date().toISOString(), browser: "agent-browser", size: [W, H], specs: {}, passed: false, sourceFidelityAccepted: false };
if (resume && JSON.stringify(status.codeHashes) !== JSON.stringify(codeHashes)) throw new Error("Capture code changed; begin a fresh capture before resuming");
status.codeHashes = codeHashes;
status.requiredFrames = requiredFrames;
status.runs ??= [];
delete status.error;
delete status.cleanupError;
let runPassed = false;
const checkpoint = () => writeFileSync(path.join(output, "playback-render-status.json"), JSON.stringify(status, null, 2) + "\n");
const stopVite = async () => { await vite?.close(); };
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  status.error = `Interrupted by ${signal}; partial captures only`;
  checkpoint();
  try { await agent("close"); } finally { await stopVite(); rmSync(scratch, { recursive: true, force: true }); process.exit(1); }
});
try {
  const vitePort = await freePort(5199);
  // Other workers can edit source concurrently. Do not reload the inspected page mid-capture.
  vite = await createViteServer({ root: app, server: { host: "127.0.0.1", port: vitePort, strictPort: true, hmr: false } });
  await vite.listen();
  status.vitePort = vitePort;
  console.log(`Headless viewer on ${vitePort}; own agent-browser session ${session}`);
  await agent("set", "viewport", String(W), String(H));
  for (const name of want) {
    const specPath = path.relative(app, path.resolve(app, SPECS[name] ?? name));
    const tag = SPECS[name] ? name : path.basename(name, ".json").replace(/[^a-zA-Z0-9_-]/g, "_");
    const mappingPath = [specPath + ".build.json", specPath.replace(/\.json$/, ".build.json")].find((p) => existsSync(path.join(app, p)));
    const query = new URLSearchParams({ spec: specPath, mapping: mappingPath ?? "none" });
    await agent("open", `http://127.0.0.1:${vitePort}/tests/render/viewer.html?${query}`);
    await agent("snapshot", "-i");
    await agent("wait", "--fn", "window.__ready === true");
    const error = await evaluate("window.__error ?? null");
    if (error) throw new Error(error);
    const info = await evaluate("window.__info");
    const prior = status.specs[tag];
    if (prior && (prior.sha256 !== info.specSha256 || prior.mappingSha256 !== info.mappingSha256)) throw new Error("Spec or build metadata changed between capture batches; start again");
    const entry = prior ?? { spec: specPath, sha256: info.specSha256, mappingSha256: info.mappingSha256, transform: info, times: {}, screenshots: [] };
    status.specs[tag] = entry;
    checkpoint();
    if (info.specSha256 && info.specSha256 !== sha(path.join(app, specPath))) throw new Error(`${specPath} changed during browser load; rerun against a stable integrated spec`);
    if (!info.sourceCameraAvailable && requireSource) throw new Error(`${specPath}: missing X_REF/Y_median builder metadata; source comparison refused`);
    const comparisonMode = info.sourceCameraAvailable && !overviewOnly ? "source" : "overview";
    entry.comparisonMode = comparisonMode;
    for (const frame of FRAMES) {
      const t = frame / 12.5;
      const sourceTime = t;
      const src = path.join(output, `playback-source-f${frame}.png`);
      ffmpeg(["-i", video, "-vf", `select=eq(n\\,${frame}),crop=479:300:481:304:exact=1,scale=${W}:${H}`, "-vsync", "0", "-frames:v", "1", src]);
      const capture = async (mode, out) => {
        const result = await evaluate(`window.__frame(${t}, ${JSON.stringify(mode)})`);
        await evaluate("window.__render()");
        await agent("screenshot", out);
        entry.screenshots.push({ t, mode, path: out });
        return result;
      };
      const overview = path.join(output, `playback-overview-${tag}-f${frame}.png`);
      let result = await capture("overview", overview);
      const shot = path.join(scratch, `${tag}-${t}.png`);
      if (comparisonMode === "source") result = await capture("source", shot);
      else copyFileSync(overview, shot);
      const comparison = path.join(output, `playback-compare-${tag}-f${frame}.png`);
      ffmpeg(["-i", src, "-i", shot, "-filter_complex", "hstack", comparison]);
      entry.screenshots.push({ t, mode: `source-vs-${comparisonMode}`, path: comparison });
      entry.times[t] = { sourceFrame: frame, sourceTime, renderTime: t, ...result };
      checkpoint();
      console.log(`${tag} ${t}s: ${result.visible}/${result.expectedIds.length} visible; coverage ${result.coverageMatches ? "OK" : "MISMATCH"}; source-vs-${comparisonMode}`);
    }
    entry.console = await agent("console");
    entry.pageErrors = await agent("errors");
    entry.consoleErrors = [...(entry.consoleErrors ?? []), ...(entry.console.messages ?? []).filter((m) => m.type === "error")];
    entry.allPageErrors = [...(entry.allPageErrors ?? []), ...(entry.pageErrors.errors ?? [])];
    status.runs.push({ session, generated: new Date().toISOString(), spec: tag, sha256: info.specSha256,
      mappingSha256: info.mappingSha256, frames: FRAMES, consoleErrors: entry.consoleErrors, pageErrors: entry.pageErrors.errors ?? [] });
  }
  // Both source frames that straddle t=17s, retained for manual review of timing/occlusions.
  for (const frame of [212, 213]) ffmpeg(["-i", video, "-vf", `select=eq(n\\,${frame}),crop=479:300:481:304:exact=1,scale=${W}:${H}`, "-vsync", "0", "-frames:v", "1", path.join(output, `playback-source-frame-${frame}.png`)]);
  runPassed = Object.values(status.specs).every((s) => Object.values(s.times).every((t) => t.coverageMatches) && s.consoleErrors.length === 0 && (s.allPageErrors ?? []).length === 0);
  status.complete = Object.values(status.specs).every((s) => requiredFrames.every((f) => s.times[f / 12.5]));
  status.passed = runPassed && status.complete;
} catch (error) {
  status.error = error.stack || String(error);
  process.exitCode = 1;
  console.error(status.error);
} finally {
  try { await agent("close"); } catch (error) { status.cleanupError = String(error); process.exitCode = 1; }
  await stopVite();
  status.limitation = "Passing establishes viewer/keyframe coverage, not source identity/measurement accuracy. Missing mapping uses overview comparisons. Prior 2026-11-15T15:11 fallback/fixture images used a flipped optical-axis sign and inferred van registration; they are superseded.";
  checkpoint();
  rmSync(scratch, { recursive: true, force: true });
}
if (!runPassed) process.exitCode = 1;
