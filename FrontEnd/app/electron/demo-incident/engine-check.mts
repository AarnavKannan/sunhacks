// Runs the app's real motion planner on incident-spec.json and prints the crash pair's poses.
// From FrontEnd/app:  <tsx> --tsconfig tsconfig.json electron/demo-incident/engine-check.mts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planMotion, trackAt } from "../../src/gemini/motion.ts";
import { sanitizeSpec, type IncidentSpec } from "../../src/gemini/spec.ts";

const here = dirname(fileURLToPath(import.meta.url));
const spec: IncidentSpec = JSON.parse(readFileSync(join(here, "incident-spec.json"), "utf8"));
const lanes = { forward: [-2.925, -6.675, -10.425], backward: [2.925, 6.675, 10.425] };
const plan = planMotion(spec, { seed: 1, friction: { mu: 0.8, range: [0.7, 0.9] }, lanes });

let failed = false;
const fail = (msg: string) => {
  failed = true;
  console.log("FAIL", msg);
};
console.log(`objects in spec ${spec.objects.length}, planned ${plan.vehicles.length}, removed ${plan.removed.length}`);
if (plan.vehicles.length !== spec.objects.length || plan.removed.length) fail(`engine removed: ${JSON.stringify(plan.removed)}`);
console.log("crash:", JSON.stringify(plan.crash));

const want: Record<string, Record<string, [number, number, number]>> = {
  "white-van": { "21": [15, -2.925, 0], "22.3": [15, -2.925, 0] },
  "yellow-car": { "22.3": [10.03, -1.9, 18] },
};
for (const id of ["white-van", "yellow-car"]) {
  const v = plan.vehicles.find((p) => p.object.id === id);
  if (!v) {
    fail(`${id} missing`);
    continue;
  }
  for (const t of [0, 15, 21, 22.3, 22.6, 23, 24, 30, 59.9]) {
    const { p, h } = trackAt(v.track, t);
    const k = v.object.keyframes;
    const hidden = t < k[0].t_s - 1e-6 || t > k[k.length - 1].t_s + 1e-6;
    console.log(`${id.padEnd(10)} t=${String(t).padEnd(5)} x=${p[0].toFixed(2).padStart(7)} y=${p[1].toFixed(2).padStart(6)} h=${h.toFixed(1).padStart(6)}${hidden ? "  (hidden)" : ""}`);
    const w = want[id][String(t)];
    if (w && (Math.abs(p[0] - w[0]) > 0.15 || Math.abs(p[1] - w[1]) > 0.15 || Math.abs(h - w[2]) > 1)) fail(`${id} at ${t}: got ${p[0]},${p[1]},${h} want ${w}`);
  }
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
