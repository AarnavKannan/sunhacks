import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planMotion, trackAt } from "../src/gemini/motion";
const data = JSON.parse(readFileSync("apps/desktop/tests/codex-vision-live-result.json", "utf8"));
const original = data.spec.objects[0];
const objects = Array.from({ length: 131 }, (_, i) => ({ ...original, id: `v${i}`, label: `v${i}`, keyframes: [
  { t_s: 0, x_m: i, y_m: 0, heading_deg: 0, speed_mps: 1 },
  { t_s: 10, x_m: i + 10, y_m: 3, heading_deg: 10, speed_mps: 1 },
  { t_s: 20, x_m: i + 20, y_m: 0, heading_deg: 0, speed_mps: 1 },
] }));
const spec = { ...data.spec, duration_s: 60, objects, crash: { start_s: 15, end_s: 16, participants: ["v0", "v1"], contacts: [] } };
const start = performance.now();
const result = planMotion(spec, { seed: 1, friction: { mu: 0.5, range: [0.3, 0.8] } });
assert.equal(result.vehicles.length, objects.length);
assert.equal(result.removed.length, 0);
assert.equal(result.crash?.start_s, 15);
for (const [i, vehicle] of result.vehicles.entries()) {
  for (const [t, x, y] of [[0, i, 0], [10, i + 10, 3], [20, i + 20, 0]]) {
    const pose = trackAt(vehicle.track, t);
    assert.ok(Math.abs(pose.p[0] - x) < 1e-8 && Math.abs(pose.p[1] - y) < 1e-8);
  }
}
console.log(`131 overlapping tracks retained; keyframes and crash time preserved in ${(performance.now() - start).toFixed(0)} ms`);
