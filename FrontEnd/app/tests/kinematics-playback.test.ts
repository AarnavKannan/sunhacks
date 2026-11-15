/** Synthetic vector/playback contract checks; these do not certify measurements of the real clip. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import type { IncidentSpec, Keyframe, SpecObject } from "../src/gemini/spec";

// Built-in library scenes import video URLs through Vite. This Node test only needs their metadata.
registerHooks({ load(url, context, nextLoad) {
  return /\.mp4(?:\?|$)/.test(url) ? { format: "module", source: 'export default "test-video";', shortCircuit: true } : nextLoad(url, context);
} });
const { buildGeminiScene } = await import("../src/gemini/engine");
const { deriveSceneKinematics, sourceFps } = await import("../src/kinematics/derive");
const { ensureKinematics, rememberSceneSource } = await import("../src/kinematics/store");

const FPS = 12.5;
const spec = JSON.parse(readFileSync(new URL("../electron/demo-incident/incident-spec.json", import.meta.url), "utf8")) as IncidentSpec;
spec.prompt_version = "measured-a9-test";
spec.duration_s = 32;
spec.objects = [];
const makeObject = (id: string, at: (t: number) => [number, number], first = 0, last = 399): SpecObject => ({
  id, label: id, category: "sedan", color_name: "yellow", color_hex: "#ffff00", make: null, model: null,
  involvement: id === "background" || id === "accelerating" ? "background" : "crash",
  length_m: 4.4, width_m: 1.8, mass_kg: 1500, visible_from_s: first / FPS, visible_to_s: last / FPS,
  keyframes: Array.from({ length: last - first + 1 }, (_, k): Keyframe => {
    const f = first + k;
    const t = f / FPS;
    const [x, y] = at(t);
    return { t_s: t, x_m: x, y_m: y, heading_deg: 350 + Math.min(t, 24), speed_mps: t >= 24 && id === "yellow-car" ? 0 : 5,
      src: f >= 45 && f <= 50 ? "interpolated" : "measured", sigma_m: f >= 45 && f <= 50 ? 0.8 : 0.2 };
  }), forces: [], rest: null, confidence: 0.9,
});
spec.objects = [
  makeObject("yellow-car", (t) => [t < 16 ? 12 * t : 192 + 2 * (Math.min(t, 24) - 16), -3 + Math.sin(Math.min(t, 24) * 0.4)], 0, 317),
  makeObject("white-van", (t) => [197 + 3 * Math.max(0, Math.min(t, 24) - 16), -3]),
  makeObject("background", (t) => [100 + 5 * t, -8], 125, 275),
  makeObject("accelerating", (t) => [0.5 * t * t, -12]),
];
spec.static_objects = [{
  id: "median-divider", kind: "median_divider", label: "bushy median divider", footprint_m: [[-50, -1], [250, -1], [250, 0], [-50, 0]],
  height_m: 1, material: "hedge_over_barrier", friction: 0.6, restitution: 0.1, stiffness_n_per_m: 500000,
  immovable: true, source: "measured", sigma_m: 0.3, note: "synthetic geometry",
}];
spec.crash = { start_s: 16, end_s: 24, kind: "synthetic", description: "contract fixture", participants: ["yellow-car", "white-van"], contacts: [
  { a: "yellow-car", b: "white-van", kind: "vehicle-vehicle", frame: 200, t_s: 16, x_m: 194, y_m: -3, normal_deg: 0, impulse_ns: 15000, source: "measured" },
  { a: "yellow-car", b: "median-divider", kind: "vehicle-static", frame: 210, t_s: 16.8, x_m: 194, y_m: -1, normal_deg: 90, impulse_ns: 2000, source: "inferred" },
] };

function build(input: IncidentSpec) {
  const built = buildGeminiScene({ id: "kin-playback-fixture", spec: input, seed: 7, created: "2026-11-15" });
  rememberSceneSource(built.scene.id, input);
  return built;
}
const close = (a: number, b: number, tol = 1e-4) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const built = build(spec);
const result = deriveSceneKinematics(built.scene)!;
assert.equal(sourceFps(spec), FPS);
assert.deepEqual(result.meta.frame_grid, { fps: FPS, first_frame: 0, last_frame: 399, source: "video" });
assert.match(result.meta.version!, /kin-v5\|measured-a9-test#/);
assert.match(result.meta.basis, /central differences/);
assert.equal(deriveSceneKinematics(built.scene)!.meta.hash, result.meta.hash);
const byId = new Map(result.meta.entities.map((e) => [e.id, result.frames.filter((f) => f.entity_id === e.id)]));
for (const vehicle of built.scene.vehicles) {
  const rows = byId.get(vehicle.id)!;
  const motion = built.layout.vehicles.find((v) => v.id === vehicle.id)!;
  for (let f = 0; f < 400; f++) {
    const pose = motion.poseAt(f / FPS);
    assert.equal(rows.some((r) => r.frame === f), !pose.hidden, `${vehicle.id} frame ${f} visibility`);
  }
  for (const r of rows) {
    const pose = motion.poseAt(r.t);
    close(r.t, r.frame / FPS, 1e-9);
    close(r.position[0] + result.meta.origin_scene[0], pose.x);
    close(r.position[2] + result.meta.origin_scene[2], pose.z);
    const bearing = ((180 - pose.yaw * 180 / Math.PI) % 360 + 360) % 360;
    close(r.body_heading_deg!, bearing, 0.006);
    for (const vector of [r.position, r.velocity, r.accel, r.force_net]) assert.ok(vector.every(Number.isFinite));
    for (let k = 0; k < 3; k++) {
      close(r.force_net[k], r.mass_kg * r.accel[k], r.mass_kg * 0.0001);
      close(Object.values(r.force_parts!).reduce((s, v) => s + v[k], 0), r.force_net[k], 0.001);
    }
  }
}
for (const r of byId.get("background")!) {
  close(r.velocity[0], 5);
  close(r.accel[0], 0);
}
for (const r of byId.get("accelerating")!.slice(2, -2)) {
  close(r.velocity[0], r.t);
  close(r.accel[0], 1);
  close(r.force_net[0], 1500);
}
const yellow = byId.get("yellow-car")!;
assert.equal(yellow.length, 400, "occluded wreck remains through the last source frame");
assert.equal(yellow[48].src, "interpolated");
assert.equal(yellow[48].sigma?.position_m, 0.8);
assert.equal(yellow[399].src, "occluded-rest");
assert.ok(Math.abs(yellow[200].accel[0]) > 10, "impact velocity change is preserved");
for (const r of yellow.slice(303)) assert.deepEqual(r.velocity, [0, 0, 0]);
const divider = byId.get("median-divider")!;
assert.equal(divider.length, 400);
for (const r of divider) {
  assert.deepEqual(r.position, divider[0].position);
  assert.deepEqual([r.velocity, r.accel, r.force_net], [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
}
assert.deepEqual(result.meta.contacts!.map((c) => c.kind), ["vehicle-vehicle", "vehicle-static"]);
for (const c of result.meta.contacts!) {
  close(c.t, c.frame! / FPS);
  close(c.point[0] + result.meta.origin_scene[0], 194);
  close(Math.hypot(...c.normal), 1);
  c.impulse!.forEach((v, i) => close(v, c.normal[i] * c.impulse_ns!));
  assert.ok(c.derived.length > 0);
}
assert.deepEqual(result.meta.contacts![1].normal, [0, 0, -1], "plan +y becomes scene -z");
assert.deepEqual(divider[210].contact_with, ["yellow-car"]);

// A rebuilt spec invalidates both the content version and the stored vectors, at the same id.
const changed = structuredClone(spec);
changed.objects[0].keyframes[100].x_m += 0.1;
const rebuilt = build(changed);
const next = deriveSceneKinematics(rebuilt.scene)!;
assert.notEqual(next.meta.hash, result.meta.hash);
assert.notEqual(next.meta.version, result.meta.version);

// Two renderer syncs around a rebuild are serialized; the newest content wins.
let release!: () => void;
let started!: () => void;
const waitStarted = new Promise<void>((r) => { started = r; });
const hold = new Promise<void>((r) => { release = r; });
const hashes: string[] = [];
Object.defineProperty(globalThis, "window", { configurable: true, value: { reconstruct: { kinematics: {
  async sync(meta: { hash: string }) { hashes.push(meta.hash); if (hashes.length === 1) { started(); await hold; } },
} } } });
const first = ensureKinematics(rebuilt.scene);
await waitStarted;
const finalSpec = structuredClone(changed);
finalSpec.objects[0].keyframes[100].x_m += 0.1;
const final = build(finalSpec);
const second = ensureKinematics(final.scene);
assert.equal(hashes.length, 1);
release();
await Promise.all([first, second]);
assert.equal(hashes.length, 2);
assert.equal(hashes[1], deriveSceneKinematics(final.scene)!.meta.hash);
await ensureKinematics(final.scene);
assert.equal(hashes.length, 2, "unchanged content is not sent again");

// Real renderer controller consumes these same stored rows and exposes their full vectors.
const finalData = deriveSceneKinematics(final.scene)!;
const { sampleAt } = await import("../electron/kinematics");
const { useAppStore } = await import("../src/store/useAppStore");
const { appSceneController } = await import("../src/assistant/sceneController");
Object.assign(window.reconstruct.kinematics, {
  async incident() { return finalData.meta; },
  async sample(_id: string, entityId: string, times: number[]) {
    return sampleAt(finalData.frames.filter((r) => r.entity_id === entityId), times, FPS, finalData.meta.entities.find((e) => e.id === entityId));
  },
});
useAppStore.getState().upsertScene(final.scene);
useAppStore.getState().openScene(final.scene.id);
const answer = await appSceneController.queryKinematics("accelerating", { frame: 100 }, ["position", "velocity", "acceleration", "heading", "forces"]);
assert.equal(answer.frame, 100);
assert.equal(answer.t_s, 8);
assert.equal(answer.src, "measured");
assert.deepEqual(answer.acceleration?.vector, [1, 0, 0]);
assert.deepEqual(answer.forces?.net.vector, [1500, 0, 0]);
assert.ok(answer.body_heading);
const fixedAnswer = await appSceneController.queryKinematics("median-divider", { frame: 210 }, ["velocity", "acceleration", "forces"]);
assert.deepEqual(fixedAnswer.velocity?.value, [0, 0, 0]);
assert.deepEqual(fixedAnswer.contact_with, ["yellow-car"]);
assert.equal((await appSceneController.findEntities("the divider"))[0].id, "median-divider");
const contacts = await appSceneController.queryContacts();
assert.deepEqual(contacts.contacts.map((c) => c.t_s), [16, 16.8]);
assert.deepEqual(contacts.contacts[1].normal, [0, 0, -1]);
assert.equal((await appSceneController.seek({ frame: 213 })).t_s, 17.04);
await assert.rejects(appSceneController.queryKinematics("yellow-car", { frame: 400 }, ["speed"]), /outside/);
await assert.rejects(appSceneController.queryKinematics("yellow-car", { frame: 0.5 }, ["speed"]), /outside/);
await assert.rejects(appSceneController.queryKinematics("background", { t_s: 22.01 }, ["speed"]), /isn't in the scene/);
const between = await appSceneController.queryKinematics("accelerating", { t_s: 8.04 }, ["position"]);
assert.equal(between.src, "interpolated");
console.log(`Playback contract passed: ${result.frames.length} rows, 400 source frames, visibility, derivatives, force=m*a, static divider, contacts, provenance and rebuild invalidation.`);
console.log("Real assistant controller passed: stored vectors, acceleration/body heading, divider/contact queries, frame seeks, hidden-vehicle and invalid-frame rejection.");
