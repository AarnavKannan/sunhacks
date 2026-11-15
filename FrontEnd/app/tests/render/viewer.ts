// Vite/headless viewer of the actual engine. Source camera mode requires <spec>.build.json
// (X_REF, Y_median) from the measured builder. Missing metadata permits an overview only.
import { buildGeminiScene } from "@/gemini/engine";
import { mountScene } from "@/scene/mountScene";
import { sourceCamera, type BuildMapping, type SourceCalibration } from "./source-camera";
import type { IncidentSpec } from "@/gemini/spec";

const W: any = window;
const params = new URLSearchParams(location.search);
const specPath = params.get("spec") ?? "electron/demo-incident/incident-spec.json";
const explicitMappingPath = params.get("mapping");

async function readJson(path: string) {
  const res = await fetch("/" + path.replace(/^\//, ""));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const raw = await res.text();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { value: JSON.parse(raw), sha256 };
}

(async () => {
  const specDocument = await readJson(specPath);
  const data = specDocument.value;
  const spec: IncidentSpec = data.spec ?? data;
  const mappingPaths = explicitMappingPath === "none" ? [] : explicitMappingPath ? [explicitMappingPath] : [specPath + ".build.json", specPath.replace(/\.json$/, ".build.json")];
  let mapping: BuildMapping | null = null;
  let mappingPath: string | null = null;
  let mappingSha256: string | null = null;
  const mappingErrors: string[] = [];
  for (const path of [...new Set(mappingPaths)]) {
    try {
      const document = await readJson(path);
      const candidate = document.value;
      if (Number.isFinite(candidate.X_REF) && Number.isFinite(candidate.Y_median)) {
        if (candidate.output?.sha256 && candidate.output.sha256 !== specDocument.sha256) {
          throw new Error(`${path}: builder metadata hash does not match loaded spec`);
        }
        mapping = candidate;
        mappingPath = path;
        mappingSha256 = document.sha256;
        break;
      }
    } catch (error) { mappingErrors.push(String(error)); }
  }
  const calPath = "electron/demo-incident/measure/data/br_camera.json";
  const calDocument = await readJson(calPath);
  const calibration: SourceCalibration = calDocument.value.camera;
  if (mapping?.synthetic === false && mapping.sources?.br_camera?.sha256 && mapping.sources.br_camera.sha256 !== calDocument.sha256) {
    throw new Error("br_camera.json differs from the calibration hashed by the measured builder; source comparison refused");
  }
  const source = mapping ? sourceCamera(calibration, mapping) : null;
  const built = buildGeminiScene({ id: "playback-render", spec, seed: 42, created: "2026-11-15" });
  const viewer = await mountScene(document.getElementById("view")!, () => {});
  viewer.showProxy(built.layout.id, built.scene.vehicles, built.scene.environment, built.scene.duration);
  viewer.setLayers({ trails: false, bounds: false, hitboxes: false, hiddenVehicles: [] });
  const ids = built.scene.vehicles.map((v) => v.id);

  W.__info = {
    specPath, specSha256: specDocument.sha256, promptVersion: spec.prompt_version,
    mappingPath, mapping, mappingSha256, mappingErrors, calibrationSha256: calDocument.sha256, sourceCamera: source,
    sourceCameraAvailable: !!source, vehicles: ids.length, duration: built.scene.duration,
    sourceMeasurementsReal: mapping?.synthetic === false,
    removed: built.report.removed,
    limitation: "Source alignment includes calibrated optical axis and roll with current hashed builder metadata; synthetic/fallback renders do not establish real-data fidelity.",
  };
  // Keep GPU work in separate CDP calls: three software-rendered frames can exceed a
  // browser command timeout on the shared four-core machine.
  W.__render = () => { viewer.render(); return true; };
  W.__frame = (t: number, mode: "source" | "overview") => {
    viewer.setTime(t);
    let camera;
    if (mode === "source") {
      if (!source) throw new Error(`No builder mapping for ${specPath}. Write ${specPath}.build.json with X_REF and Y_median before comparing the source camera.`);
      camera = viewer.setCamera({ position: source.position, target: source.target }, { instant: true, fovDeg: source.fovDeg, up: source.up });
      if (camera.clamped) throw new Error("Source camera was clamped to scene bounds; comparison would be misregistered");
    } else {
      const vp = viewer.vehiclePose("white-van", t);
      const focus = vp?.position ?? built.layout.camera.target;
      camera = viewer.setCamera({ position: [focus[0] + 60, 45, focus[2] - 40], target: [focus[0] - 40, 0, focus[2] + 5] }, { instant: true, fovDeg: 32 });
    }
    viewer.resize();
    const visibleIds: string[] = [], crashSideIds: string[] = [];
    const poses: Record<string, unknown> = {};
    for (const id of ids) {
      const p = viewer.vehiclePose(id, t);
      poses[id] = p;
      if (!p || p.hidden) continue;
      visibleIds.push(id);
      if (-p.position[2] < 0) crashSideIds.push(id);
    }
    const expectedIds = spec.objects.filter((o) => o.keyframes.length && t >= o.keyframes[0].t_s - 1e-6 && t <= o.keyframes.at(-1)!.t_s + 1e-6).map((o) => o.id).sort();
    return { t, mode, camera, visible: visibleIds.length, visibleIds, expectedIds, poses, crashSideIds, coverageMatches: JSON.stringify([...visibleIds].sort()) === JSON.stringify(expectedIds) };
  };
  W.__ready = true;
})().catch((e) => { W.__error = String(e?.stack || e); W.__ready = true; });
