// Runs the app's real motion planner, checking measured or historical fixture poses.
// From FrontEnd/app:  <tsx> --tsconfig tsconfig.json electron/demo-incident/engine-check.mts [spec.json]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planMotion, trackAt } from "../../src/gemini/motion.ts";
import { sanitizeSpec, type IncidentSpec } from "../../src/gemini/spec.ts";

const here = dirname(fileURLToPath(import.meta.url));
const spec: IncidentSpec = JSON.parse(readFileSync(process.argv[2] ?? join(here, "incident-spec.json"), "utf8"));
const centers = (lines: number[], sign: number) => lines.slice(1).map((v, i) => sign * (v + lines[i]) / 2);
const lanes = spec.road.lane_lines_forward_m && spec.road.lane_lines_backward_m
  ? { forward: centers(spec.road.lane_lines_forward_m, -1), backward: centers(spec.road.lane_lines_backward_m, 1) }
  : { forward: [-2.925, -6.675, -10.425], backward: [2.925, 6.675, 10.425] };
const plan = planMotion(spec, { seed: 1, friction: { mu: 0.8, range: [0.7, 0.9] }, lanes });

let failed = false;
const fail = (msg: string) => {
  failed = true;
  console.log("FAIL", msg);
};
console.log(`objects in spec ${spec.objects.length}, planned ${plan.vehicles.length}, removed ${plan.removed.length}`);
if (plan.vehicles.length !== spec.objects.length || plan.removed.length) fail(`engine removed: ${JSON.stringify(plan.removed)}`);
console.log("crash:", JSON.stringify(plan.crash));

const want: Record<string, Record<string, [number, number, number]>> = /measured/.test(spec.prompt_version) ? {} : {
  "white-van": { "21": [15, -2.925, 0], "22.3": [15, -2.925, 0] },
  "yellow-car": { "22.3": [10.03, -1.9, 18] },
};
for (const id of ["white-van", "yellow-car"]) {
  const v = plan.vehicles.find((p) => p.object.id === id);
  if (!v) {
    fail(`${id} missing`);
    continue;
  }
  for (const t of [...new Set([0, 15, 17, 21, spec.crash?.start_s ?? 22.3, 23, 24, 30, spec.duration_s - 0.08])]) {
    const { p, h } = trackAt(v.track, t);
    const k = v.object.keyframes;
    const hidden = t < k[0].t_s - 1e-6 || t > k[k.length - 1].t_s + 1e-6;
    console.log(`${id.padEnd(10)} t=${String(t).padEnd(5)} x=${p[0].toFixed(2).padStart(7)} y=${p[1].toFixed(2).padStart(6)} h=${h.toFixed(1).padStart(6)}${hidden ? "  (hidden)" : ""}`);
    const w = want[id]?.[String(t)];
    if (w && (Math.abs(p[0] - w[0]) > 0.15 || Math.abs(p[1] - w[1]) > 0.15 || Math.abs(h - w[2]) > 1)) fail(`${id} at ${t}: got ${p[0]},${p[1]},${h} want ${w}`);
  }
}

let worst = 0;
for (const v of plan.vehicles) for (const k of v.object.keyframes) {
  const { p } = trackAt(v.track, k.t_s);
  worst = Math.max(worst, Math.hypot(p[0] - k.x_m, p[1] - k.y_m));
}
console.log(`max keyframe pose error ${worst.toFixed(6)} m`);
if (worst > 1e-6) fail("motion altered observed keyframes");
const idsOfVehicles = new Set(spec.objects.map((o) => o.id));
const idsOfStatics = new Set((spec.static_objects ?? []).map((o) => o.id));
for (const c of spec.crash?.contacts ?? []) {
  if (!idsOfVehicles.has(c.a) || !(idsOfVehicles.has(c.b) || idsOfStatics.has(c.b))) fail("unknown contact id");
  if (!Number.isFinite(c.normal_deg)) fail("invalid contact normal");
  if (c.frame !== undefined && Math.abs(c.frame / 12.5 - c.t_s) > 1e-6) fail("contact clock mismatch");
  if (idsOfStatics.has(c.b) && c.kind !== "vehicle-static") fail("static contact kind");
}

// Not used by the demo path (gemini.ts loads the file as-is), but confirm sanitizeSpec keeps every object.
const s = sanitizeSpec(spec);
const ids = new Set(spec.objects.map((o) => o.id));
const changed = s.objects.filter((o) => !ids.has(o.id)).map((o) => o.id);
const resized = s.objects.filter((o) => {
  const src = spec.objects.find((x) => x.id === o.id);
  return src && (src.length_m !== o.length_m || src.width_m !== o.width_m || src.mass_kg !== o.mass_kg || src.keyframes.length !== o.keyframes.length);
});
console.log(`sanitizeSpec: ${s.objects.length} objects, renamed ${changed.length}, resized/clipped ${resized.map((o) => o.id).join(",") || "none"}`);
if (s.objects.length !== spec.objects.length || changed.length || resized.length) fail("sanitizeSpec would alter objects");
console.log(failed ? "ENGINE CHECK FAIL" : "ENGINE CHECK PASS");
process.exit(failed ? 1 : 0);
