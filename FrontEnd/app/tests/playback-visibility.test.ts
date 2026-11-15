// From FrontEnd/app:
// npx tsx --tsconfig tsconfig.json tests/playback-visibility.test.ts [spec.json ...]
// Defaults to the production demo and the synthetic measured-builder fixture. No Electron/DB.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import * as THREE from "three";
import { makeVehicle } from "../src/scene/cars";
import { buildGeminiScene } from "../src/gemini/engine";
import { planMotion, trackAt } from "../src/gemini/motion";
import type { IncidentSpec, Keyframe, SpecObject } from "../src/gemini/spec";

const TIMES = [0, 10, 15, 17, 20, 24, 28, 31.92];
const EPS = 1e-6;
const TOL = 1e-8;
const options = { seed: 42, friction: { mu: 0.7, range: [0.6, 0.8] as [number, number] } };
const app = fileURLToPath(new URL("../", import.meta.url));

// Independent oracle: read the supplied observations, not the planner's rewritten object/arrays.
function observations(object: SpecObject): Keyframe[] {
  const byTime = new Map<number, Keyframe>();
  for (const k of object.keyframes) {
    if ([k.t_s, k.x_m, k.y_m].every(Number.isFinite)) byTime.set(k.t_s, k);
  }
  return [...byTime.values()].sort((a, b) => a.t_s - b.t_s);
}
const covers = (ks: Keyframe[], t: number) => ks.length > 0 && ks[0].t_s <= t + EPS && ks.at(-1)!.t_s >= t - EPS;
function expectedAt(ks: Keyframe[], t: number) {
  let a = ks[0];
  let b = a;
  for (const k of ks) {
    b = k;
    if (k.t_s >= t) break;
    a = k;
  }
  const u = a.t_s === b.t_s ? 0 : Math.max(0, Math.min(1, (t - a.t_s) / (b.t_s - a.t_s)));
  let dh = Math.atan2(Math.sin((b.heading_deg - a.heading_deg) * Math.PI / 180), Math.cos((b.heading_deg - a.heading_deg) * Math.PI / 180)) * 180 / Math.PI;
  // An exact half-turn has two equally short arcs. The documented [-180,180) heading
  // convention selects the negative tie; sin(pi)'s rounding must not choose the opposite arc.
  if (Math.abs(Math.abs(dh) - 180) < 1e-10) dh = -180;
  return { x: a.x_m + (b.x_m - a.x_m) * u, y: a.y_m + (b.y_m - a.y_m) * u, h: a.heading_deg + dh * u };
}
function close(actual: number, expected: number, label: string) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= TOL, `${label}: ${actual} != ${expected}`);
}
function angleClose(actual: number, expected: number, label: string) {
  close(Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected)), 0, label);
}

function checkSpec(spec: IncidentSpec, label: string) {
  const before = JSON.stringify(spec);
  const plan = planMotion(spec, options);
  const built = buildGeminiScene({ id: `visibility-${label}`, spec, seed: 42, created: "test" });
  const planned = new Map(plan.vehicles.map((v) => [v.object.id, v]));
  const motions = new Map(built.layout.vehicles.map((v) => [v.id, v]));
  const info = new Map(built.scene.vehicles.map((v) => [v.id, v]));
  const observed = new Map(spec.objects.map((o) => [o.id, observations(o)]));
  if (/^(measured-a9-|hand-verified-measured)/.test(spec.prompt_version)) {
    if (spec.road.lane_lines_forward_m && spec.road.lane_lines_backward_m) {
      assert.ok(built.layout.site.width >= 1700, "site excludes measured road ends");
    }
    for (const object of spec.objects) {
      const motion = motions.get(object.id);
      assert.ok(motion, `${object.id}: measured object has no mesh`);
      const rig = makeVehicle(motion.kind!, object.color_hex, object.id, motion.modelLabel);
      assert.ok(motion.scaleXYZ, "measured footprint was replaced with a model size");
      rig.root.scale.set(...motion.scaleXYZ);
      const size = new THREE.Box3().setFromObject(rig.root).getSize(new THREE.Vector3());
      close(size.x, object.width_m, `${object.id}: rendered width`);
      close(size.z, object.length_m, `${object.id}: rendered length`);
      if (object.height_m) close(size.y, object.height_m, `${object.id}: rendered height`);
      if (object.category === "motorcycle") {
        assert.equal(motion.kind, "motorcycle");
        assert.equal(rig.wheels.length, 2, "motorcycle was disguised as a car");
      }
      rig.root.traverse((node) => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
      for (const k of object.keyframes) {
        assert.ok(Math.abs(k.x_m) < built.layout.site.width / 2, `${object.id}: outside longitudinal site bounds`);
        assert.ok(Math.abs(k.y_m) < built.layout.site.depth / 2, `${object.id}: outside lateral site bounds`);
      }
    }
  }
  const expectedIds = spec.objects.filter((o) => observed.get(o.id)!.length).map((o) => o.id).sort();
  assert.deepEqual([...planned.keys()].sort(), expectedIds, `${label}: planner dropped an object`);
  assert.deepEqual([...motions.keys()].sort(), expectedIds, `${label}: layout dropped an object`);
  assert.deepEqual([...info.keys()].sort(), expectedIds, `${label}: scene metadata dropped an object`);
  assert.equal(plan.crash?.start_s ?? null, spec.crash?.start_s ?? null, "contact time changed");

  const checkPose = (id: string, ks: Keyframe[], t: number) => {
    const expected = expectedAt(ks, t);
    const p = trackAt(planned.get(id)!.track, t);
    const pose = motions.get(id)!.poseAt(t);
    close(p.p[0], expected.x, `${label}/${id}/${t}: plan x`);
    close(p.p[1], expected.y, `${label}/${id}/${t}: plan y`);
    angleClose(p.h * Math.PI / 180, expected.h * Math.PI / 180, `${id}: heading`);
    close(pose.x, expected.x, `${id}: scene x`);
    close(pose.z, -expected.y, `${id}: scene z`);
    // A model's +z forward maps to (cos h, -sin h) in the scene.
    close(Math.sin(pose.yaw), Math.cos(expected.h * Math.PI / 180), `${id}: facing x`);
    close(Math.cos(pose.yaw), -Math.sin(expected.h * Math.PI / 180), `${id}: facing z`);
    assert.equal(!!pose.hidden, false, `${label}/${id}/${t}: covered observation hidden`);
  };

  const times = TIMES.map((t) => {
    const expected = spec.objects.filter((o) => covers(observed.get(o.id)!, t)).map((o) => o.id).sort();
    const planVisible = plan.vehicles.filter((v) => t >= v.visible[0] - EPS && t <= v.visible[1] + EPS).map((v) => v.object.id).sort();
    const layoutVisible = built.layout.vehicles.filter((v) => !v.poseAt(t).hidden).map((v) => v.id).sort();
    const metadataVisible = built.scene.vehicles.filter((v) => t >= v.visibleFrom! - EPS && t <= v.visibleTo! + EPS).map((v) => v.id).sort();
    assert.deepEqual(planVisible, expected, `${label}/${t}: planned visibility != keyframe coverage`);
    assert.deepEqual(layoutVisible, expected, `${label}/${t}: posed visibility != keyframe coverage`);
    assert.deepEqual(metadataVisible, expected, `${label}/${t}: metadata visibility != keyframe coverage`);
    for (const id of expected) checkPose(id, observed.get(id)!, t);
    return { t, visible: expected.length, ids: expected };
  });

  let checked = 0;
  for (const [id, ks] of observed) {
    if (!ks.length) continue;
    for (let i = 0; i < ks.length; i++) {
      checkPose(id, ks, ks[i].t_s);
      if (i) checkPose(id, ks, (ks[i - 1].t_s + ks[i].t_s) / 2);
      checked++;
    }
    assert.equal(motions.get(id)!.poseAt(ks[0].t_s - 1e-4).hidden, true, `${id}: early appearance`);
    // A deliberate stopped-wreck hold is tested separately below. These input files already
    // carry their complete crash aftermath, so the coverage comparison uses the original spec.
    const last = ks.at(-1)!;
    if (planned.get(id)!.visible[1] <= last.t_s + EPS) {
      assert.equal(motions.get(id)!.poseAt(last.t_s + 1e-4).hidden, true, `${id}: late disappearance`);
    }
  }
  assert.equal(JSON.stringify(spec), before, "playback mutated input evidence");
  console.log(`${label}: ${expectedIds.length} objects, ${checked} keyframes + midpoints; visible ${times.map((t) => `${t.t}s=${t.visible}`).join(", ")}`);
  return { objects: expectedIds.length, keyframes: checked, times };
}

const paths = process.argv.slice(2);
const specs = (paths.length ? paths.map((p) => resolve(p)) : [
  resolve(app, "electron/demo-incident/incident-spec.json"),
  resolve(app, "electron/demo-incident/measure/review_spec/incident-spec.json"),
]).map((path) => {
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw);
  const spec: IncidentSpec = data.spec ?? data;
  return { path, sha256: createHash("sha256").update(raw).digest("hex"), promptVersion: spec.prompt_version, spec };
});

// Per-frame lateral wiggle, heading wrap, non-SIM_HZ-aligned observations, narrow observation
// visibility metadata, and every provenance type must survive the entire engine path.
const base = specs[0].spec;
const prototype = base.objects[0];
const sources = ["measured", "interpolated", "edge-extrapolated", "out-of-view-extrapolated", "occluded-rest"] as const;
const samples = [0, 10, 15, 16.953, 17.033, 17.113, 20, 24, 28, 31.92];
const regression: IncidentSpec = {
  ...base, duration_s: 31.92,
  objects: sources.map((src, i) => ({
    ...prototype, id: src, label: src, involvement: i ? "background" : "crash",
    visible_from_s: 22.8, visible_to_s: 24, lane_hint: { direction: "against", lane_from_median: 1, first_seen_s: 22.8, last_seen_s: 24, speed_mps: 1, stopped: true, cameras: [] },
    keyframes: samples.map((t_s, j) => ({ t_s, x_m: 2 * t_s, y_m: -8 + (j % 2 ? 1 : -1), heading_deg: j % 2 ? -179 : 177, speed_mps: 999, src, sigma_m: 2 })),
    forces: [{ t_s: 17, fx_n: 1e8, fy_n: 1e8, cause: "impact", note: "must not alter replay" }], rest: null,
  })),
  crash: { start_s: 22.8, end_s: 24, kind: "rear_end", description: "regression", participants: ["measured", "interpolated"], contacts: [{ a: "measured", b: "interpolated", t_s: 22.8, x_m: 200, y_m: 200, normal_deg: 90 }] },
};
checkSpec(regression, "provenance-wiggle");

const wreckFrames = [{ t_s: 23, x_m: 10, y_m: -3, heading_deg: 23, speed_mps: 0 }, { t_s: 25, x_m: 10, y_m: -3, heading_deg: 23, speed_mps: 0 }];
const lostAnnotation: IncidentSpec = { ...regression, duration_s: 32, objects: [{ ...prototype, id: "wreck", keyframes: wreckFrames }, { ...prototype, id: "leaving", keyframes: [{ ...wreckFrames[0], speed_mps: 5 }, { ...wreckFrames[1], x_m: 20, speed_mps: 5 }] }], crash: { ...regression.crash!, participants: ["wreck", "leaving"] } };
const held = planMotion(lostAnnotation, options);
const wreck = held.vehicles.find((v) => v.object.id === "wreck")!;
assert.deepEqual(wreck.visible, [23, 32]);
assert.equal(wreck.object.keyframes.at(-1)!.src, "occluded-rest");
assert.deepEqual(trackAt(wreck.track, 31.92).p, [10, -3]);
assert.deepEqual(held.vehicles.find((v) => v.object.id === "leaving")!.visible, [23, 25], "moving crash vehicle held after leaving camera");
assert.equal(lostAnnotation.objects[0].keyframes.length, 2, "hold leaked into input evidence");
const heldScene = buildGeminiScene({ id: "visibility-occluded-wreck", spec: lostAnnotation, seed: 42, created: "test" });
assert.equal(heldScene.layout.vehicles.find((v) => v.id === "wreck")!.poseAt(31.92).hidden, false);
assert.equal(heldScene.layout.vehicles.find((v) => v.id === "leaving")!.poseAt(31.92).hidden, true);

const results = specs.map(({ spec, ...source }) => {
  try {
    return { ...source, passed: true, ...checkSpec(spec, source.path) };
  } catch (error) {
    const built = buildGeminiScene({ id: "visibility-failure-diagnostic", spec, seed: 42, created: "test" });
    const posed = new Set(built.layout.vehicles.map((v) => v.id));
    const dropped = spec.objects.filter((o) => o.keyframes.length && !posed.has(o.id)).map((o) => ({ id: o.id, category: o.category, bounds: [o.keyframes[0].t_s, o.keyframes.at(-1)!.t_s] }));
    console.error(`${source.path}: FAILED; dropped ${JSON.stringify(dropped)}`);
    return { ...source, passed: false, error: String(error), dropped };
  }
});
const passed = results.every((r) => r.passed);
writeFileSync(new URL("./playback-visibility-status.json", import.meta.url), JSON.stringify({ generated: new Date().toISOString(), passed, specs: results, limitation: "Playback fidelity to these exact input files; source measurement/identity accuracy and pixel visibility are separate checks." }, null, 2) + "\n");
assert.ok(passed, "Playback coverage failed; see tests/playback-visibility-status.json for exact input hashes and dropped objects");
