// Demo-fit comparison harness: real crash-camera tile vs the REAL app viewer (engine + mountScene)
// rendered from the calibrated source camera.
//
// Run (from the repo root):
//   FrontEnd/app/node_modules/electron/dist/electron.exe FrontEnd/app/tests/demo-fit/harness/compare.cjs \
//     --frames 0,125,213,250,270,279,284,288,291,300,320,350,399 [--out <dir>] [--spec <spec.json>] [--scale 1|2]
//
// Writes into --out (default FrontEnd/app/tests/demo-fit/sheets/latest/):
//   sheet_<frame>.png   real | render / 50% blend | render + calib lane lines + vehicle ids
//   contact.png         all frames, real | render | blend
//   real/<frame>.png, render/<frame>.png, blend/<frame>.png
//   report.json         camera, validation pixel errors, vehicles in view per frame
const { app, BrowserWindow } = require("electron");
const { build } = require("esbuild");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("ignore-gpu-blocklist");

const HERE = __dirname;
const APP = path.resolve(HERE, "..", "..", "..");
const REPO = path.resolve(APP, "..", "..");
const MEASURE = path.join(APP, "electron", "demo-incident", "measure");

function args() {
  const argv = process.argv.slice(1);
  const get = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const frames = get("--frames", "0,125,213,250,270,279,284,288,291,300,320,350,399").split(",").map((s) => parseInt(s, 10)).filter(Number.isFinite);
  return {
    frames,
    out: path.resolve(get("--out", path.join(APP, "tests", "demo-fit", "sheets", "latest"))),
    spec: path.resolve(get("--spec", path.join(APP, "electron", "demo-incident", "incident-spec.json"))),
    video: path.resolve(get("--video", path.join(REPO, "demo.mp4"))),
    scale: Math.max(1, Math.min(2, parseInt(get("--scale", "1"), 10) || 1)),
  };
}

// Burned-in yellow 3D box of the stopped van (calib.py VAN_IMG), tile pixels.
const VAN_IMG = [[69.0, 208.0], [121.5, 208.0], [84.5, 194.5], [134.0, 194.5], [68.5, 139.5], [121.5, 139.5], [84.5, 130.5], [134.0, 130.5]];

function extractReal(video, frame, file) {
  if (fs.existsSync(file)) return;
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", `select=eq(n\\,${frame}),crop=479:300:481:304`, "-frames:v", "1", file], { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(file)) throw new Error(`ffmpeg failed for frame ${frame}: ${r.stderr || r.error}`);
}
const dataUrl = (file) => "data:image/png;base64," + fs.readFileSync(file).toString("base64");
const writeUrl = (file, url) => fs.writeFileSync(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const opt = args();
  const deadline = setTimeout(() => { console.error("compare: timed out after 15 min"); app.exit(1); }, 15 * 60 * 1000);
  let win, code = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "demo-fit-"));
  try {
    for (const d of ["", "real", "render", "blend"]) fs.mkdirSync(path.join(opt.out, d), { recursive: true });
    // Real frames (cached per out dir; frame index n of the 12.5 fps clip).
    const realDir = path.join(opt.out, "real");
    for (const f of opt.frames) extractReal(opt.video, f, path.join(realDir, `${f}.png`));

    const spec = JSON.parse(fs.readFileSync(opt.spec, "utf8"));
    const calib = JSON.parse(fs.readFileSync(path.join(MEASURE, "data", "calib_joint.json"), "utf8"));
    const crashPair = JSON.parse(fs.readFileSync(path.join(MEASURE, "data", "crash_pair.json"), "utf8"));
    for (const v of Object.values(crashPair.vehicles)) v.samples = v.samples.filter((s) => s.f === 0);
    const js = await build({
      entryPoints: [path.join(HERE, "page.ts")],
      tsconfig: path.join(APP, "tsconfig.json"), bundle: true, format: "iife", platform: "browser", write: false, logLevel: "silent",
      define: {
        "import.meta.env.BASE_URL": JSON.stringify(pathToFileURL(path.join(APP, "public") + path.sep).href),
        __SPEC__: JSON.stringify(spec), __CALIB__: JSON.stringify(calib), __CRASH_PAIR__: JSON.stringify(crashPair),
        __SCALE__: String(opt.scale), __VAN_IMG__: JSON.stringify(VAN_IMG),
      },
    });
    fs.writeFileSync(path.join(tmp, "page.js"), js.outputFiles[0].contents);
    const bg = dataUrl(path.join(MEASURE, "data", "br_bg.png"));
    fs.writeFileSync(path.join(tmp, "index.html"), `<html><body style="margin:0;overflow:hidden;background:#000"><div id="view"></div>
<script>window.__BG__=${JSON.stringify(bg)};window.onerror=(m,s,l,c,e)=>{window.__error=String(e&&e.stack||m);window.__ready=true;};</script><script src="page.js"></script></body></html>`);

    win = new BrowserWindow({ show: false, width: 479 * opt.scale + 40, height: 300 * opt.scale + 40, webPreferences: { backgroundThrottling: false, offscreen: false } });
    const consoleLog = [];
    win.webContents.on("console-message", (_e, d, m) => consoleLog.push(`[${typeof d === "object" ? d.level : d}] ${d?.message ?? m}`));
    await win.loadFile(path.join(tmp, "index.html"));
    await win.webContents.executeJavaScript(`new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => {
      if (window.__ready) { clearInterval(i); res(true); } else if (Date.now() - t0 > 120000) { clearInterval(i); rej(new Error("viewer not ready after 120 s")); } }, 100); })`);
    const err = await win.webContents.executeJavaScript("window.__error || null");
    if (err) throw new Error(err);
    const info = await win.webContents.executeJavaScript("window.__info");
    if (info.placed?.clamped) console.warn("WARNING: viewer clamped the source camera — render is misregistered");

    const specLabel = path.relative(APP, opt.spec).replace(/\\/g, "/");
    const frames = [], contactItems = [];
    for (const f of opt.frames) {
      const realFile = path.join(realDir, `${f}.png`);
      const r = await win.webContents.executeJavaScript(`window.__sheet(${f}, ${JSON.stringify(dataUrl(realFile))}, ${JSON.stringify(specLabel)})`);
      writeUrl(path.join(opt.out, `sheet_${String(f).padStart(3, "0")}.png`), r.sheet);
      writeUrl(path.join(opt.out, "render", `${f}.png`), r.render);
      writeUrl(path.join(opt.out, "blend", `${f}.png`), r.blend);
      frames.push({ frame: f, t: f / 12.5, vehiclesInView: r.vehiclesInView });
      contactItems.push({ frame: f, real: dataUrl(realFile), render: r.render, blend: r.blend });
      process.stdout.write(`frame ${f} done\n`);
    }
    writeUrl(path.join(opt.out, "contact.png"), await win.webContents.executeJavaScript(`window.__contact(${JSON.stringify(contactItems)})`));
    const report = { spec: opt.spec, scale: opt.scale, ...info, frames, consoleErrors: consoleLog.filter((l) => /^\[(3|error)\]/.test(l)) };
    fs.writeFileSync(path.join(opt.out, "report.json"), JSON.stringify(report, null, 1));
    const v = info.validation;
    console.log(`camera clamped=${info.placed?.clamped} fov=${info.camera.fovDeg.toFixed(3)} roll=${(info.camera.roll * 180 / Math.PI).toFixed(3)} deg`);
    console.log(`van box: rms vs real labels ${v.vanBox.rmsVsReal_px} px, max vs cam.py ${v.vanBox.maxVsCalib_px} px; scene van t0 err ${v.vanScenePose_t0.err_m} m`);
    console.log("lane lines (median |du| px)  real-bg / render-t0 / max three-vs-cam.py:");
    for (const k of Object.keys(v.laneLinesRealBg)) console.log(`  ${k.padEnd(13)} ${String(v.laneLinesRealBg[k].medianAbsDu_px).padStart(6)} (${v.laneLinesRealBg[k].found}/${v.laneLinesRealBg[k].n})  ${String(v.laneLinesRender_t0[k].medianDu_px).padStart(6)} (${v.laneLinesRender_t0[k].found}/${v.laneLinesRender_t0[k].n})  ${v.laneLinesMaxVsCalib_px[k]}`);
    console.log(`wrote ${opt.out}`);
  } catch (e) {
    console.error(e?.stack || e);
    code = 1;
  } finally {
    clearTimeout(deadline);
    win?.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
    app.exit(code);
  }
});
