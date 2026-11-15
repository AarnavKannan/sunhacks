/** Final integration check for the real clip: source spec → viewer poses → Mongo → assistant. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { IncidentSpec } from "../src/gemini/spec";

registerHooks({ load(url, context, nextLoad) {
  return /\.mp4(?:\?|$)/.test(url) ? { format: "module", source: 'export default "test-video";', shortCircuit: true } : nextLoad(url, context);
} });
const spec = JSON.parse(readFileSync(new URL("../electron/demo-incident/incident-spec.json", import.meta.url), "utf8")) as IncidentSpec;
const build = JSON.parse(readFileSync(new URL("../electron/demo-incident/incident-spec.json.build.json", import.meta.url), "utf8"));
assert.equal(build.synthetic, false, "This test must use real measurements");
assert.equal(build.background_edge_extrapolation, false, "road-end extension creates unsupported in-camera traffic");
assert.equal(build.output.sha256, createHash("sha256").update(readFileSync(new URL("../electron/demo-incident/incident-spec.json", import.meta.url))).digest("hex"), "build sidecar is stale");
assert.match(spec.prompt_version, /^measured/);
assert.equal(spec.duration_s, 32);
const { buildGeminiScene } = await import("../src/gemini/engine");
const { deriveSceneKinematics } = await import("../src/kinematics/derive");
const { rememberSceneSource } = await import("../src/kinematics/store");
const { keyframePose } = await import("../src/gemini/motion");
const { sampleAt, syncIncident } = await import("../electron/kinematics");
const built = buildGeminiScene({ id: "measured-clip-integration", spec, seed: 42, created: "2026-11-15" });
rememberSceneSource(built.scene.id, spec);
const data = deriveSceneKinematics(built.scene)!;
assert.ok(data);
assert.deepEqual(data.meta.caveats, spec.caveats);
assert.deepEqual(data.meta.frame_grid, { fps: 12.5, first_frame: 0, last_frame: 399, source: "video" });
assert.equal(built.scene.vehicles.length, spec.objects.length);
assert.equal(data.meta.entities.length, spec.objects.length + (spec.static_objects?.length ?? 0));
const rows = new Map(data.meta.entities.map((entity) => [entity.id, new Map(
  data.frames.filter((row) => row.entity_id === entity.id).map((row) => [row.frame, row]),
)]));
const close = (a: number, b: number, epsilon = .00011) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const checkpoints = [0, 100, 125, 188, 212, 213, 250, 283, 291, 300, 317, 350, 399];
const visibility: { frame: number; time_s: number; count: number; ids: string[] }[] = [];
const sources = new Map<string, number>();
let poseChecks = 0;
for (const object of spec.objects) {
  const motion = built.layout.vehicles.find((vehicle) => vehicle.id === object.id)!;
  assert.ok(motion, `${object.id}: missing from viewer`);
  for (let frame = 0; frame < 400; frame++) {
    const time = frame / 12.5;
    const pose = motion.poseAt(time);
    const expectedVisible = time >= object.keyframes[0].t_s - 1e-6 && time <= object.keyframes.at(-1)!.t_s + 1e-6;
    const row = rows.get(object.id)!.get(frame);
    assert.equal(!pose.hidden, expectedVisible, `${object.id}@${frame}: viewer visibility`);
    assert.equal(!!row, expectedVisible, `${object.id}@${frame}: database visibility`);
    if (!row) continue;
    const expected = keyframePose(object.keyframes, time);
    close(pose.x, expected.p[0], 1e-8);
    close(pose.z, -expected.p[1], 1e-8);
    close(row.position[0] + data.meta.origin_scene[0], pose.x);
    close(row.position[2] + data.meta.origin_scene[2], pose.z);
    close(row.t, frame / 12.5, 1e-9);
    const exact = object.keyframes.find((key) => Math.abs(key.t_s - time) < 1e-6);
    if (exact) {
      assert.equal(row.src, exact.src, `${object.id}@${frame}: sample provenance`);
      close(row.sigma!.position_m!, exact.sigma_m!, .001);
    }
    for (const vector of [row.position, row.velocity, row.accel, row.force_net]) assert.ok(vector.every(Number.isFinite));
    for (let axis = 0; axis < 3; axis++) {
      close(row.force_net[axis], row.mass_kg * row.accel[axis], row.mass_kg * .000051 + .0001);
      close(Object.values(row.force_parts!).reduce((sum, force) => sum + force[axis], 0), row.force_net[axis], .001);
    }
    sources.set(row.src ?? "unknown", (sources.get(row.src ?? "unknown") ?? 0) + 1);
    poseChecks++;
  }
}
for (const object of spec.static_objects ?? []) {
  const fixed = [...rows.get(object.id)!.values()];
  assert.equal(fixed.length, 400);
  for (const row of fixed) {
    assert.deepEqual(row.position, fixed[0].position);
    assert.deepEqual([row.velocity, row.accel, row.force_net], [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  }
}
for (const frame of checkpoints) {
  const ids = spec.objects.filter((object) => rows.get(object.id)!.has(frame)).map((object) => object.id);
  visibility.push({ frame, time_s: frame / 12.5, count: ids.length, ids });
}
assert.equal(rows.get("yellow-car")!.get(399)!.src, "occluded-rest");
for (const contact of spec.crash!.contacts) {
  const stored = data.meta.contacts!.find((candidate) => candidate.a === contact.a && candidate.b === contact.b && candidate.frame === contact.frame)!;
  assert.ok(stored);
  close(stored.t, contact.t_s, 1e-9);
  close(stored.normal[0], Math.cos(contact.normal_deg * Math.PI / 180));
  close(stored.normal[2], -Math.sin(contact.normal_deg * Math.PI / 180));
  assert.equal(stored.impulse_ns, contact.impulse_ns ?? null);
  assert.equal(stored.source, contact.source);
}

const server = await MongoMemoryServer.create();
const client = await MongoClient.connect(server.getUri());
try {
  const db = client.db("measured_clip_integration");
  const collection = db.collection("frames");
  await collection.createIndex({ incident_id: 1, entity_id: 1, t: 1 }, { unique: true });
  const synced = await Promise.all([syncIncident(db, data.meta, data.frames), syncIncident(db, data.meta, data.frames)]);
  assert.equal(synced.filter((out) => out.synced).length, 1);
  assert.equal(await collection.countDocuments({ incident_id: data.meta._id }), data.frames.length);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { reconstruct: { kinematics: {
    async sync(meta: Parameters<typeof syncIncident>[1], frames: Parameters<typeof syncIncident>[2]) {
      return syncIncident(db, meta, frames);
    },
    async incident() { return db.collection("incidents").findOne({ _id: data.meta._id }); },
    async sample(_id: string, id: string, times: number[]) {
      const actual = await collection.find({ incident_id: data.meta._id, entity_id: id }, { projection: { _id: 0, rev: 0 } }).sort({ t: 1 }).toArray();
      return sampleAt(actual, times, data.meta.fps, data.meta.entities.find((entity) => entity.id === id));
    },
  } } } });
  const { useAppStore } = await import("../src/store/useAppStore");
  const { appSceneController } = await import("../src/assistant/sceneController");
  useAppStore.getState().upsertScene(built.scene);
  useAppStore.getState().openScene(built.scene.id);
  for (const [id, frame] of [["white-van", 212], ["white-van", 350], ["yellow-car", 291], ["yellow-car", 399], ["median-divider", 283]] as const) {
    const answer = await appSceneController.queryKinematics(id, { frame }, ["position", "velocity", "acceleration", "forces"]);
    const expected = rows.get(id)!.get(frame)!;
    assert.deepEqual(answer.position!.value, expected.position);
    assert.deepEqual(answer.velocity!.value, expected.velocity);
    assert.deepEqual(answer.acceleration!.vector, expected.accel);
    assert.deepEqual(answer.forces!.net.vector, expected.force_net);
    assert.equal(answer.src, expected.src);
    assert.equal(answer.frame, frame);
  }
  const contacts = await appSceneController.queryContacts();
  assert.equal(contacts.contacts.length, spec.crash!.contacts.length);
  assert.ok(contacts.caveats.some((note) => note.includes("f151")), "assistant lost unresolved early-identity caveat");
  const at17 = visibility.find((entry) => entry.frame === 213)!;
  const background = at17.ids.find((id) => !spec.crash!.participants.includes(id));
  assert.ok(background, "pre-crash background traffic is present at 17.04 s");
  const answer = await appSceneController.queryKinematics(background, { t_s: 17 }, ["position"]);
  const expected = built.layout.vehicles.find((vehicle) => vehicle.id === background)!.poseAt(17);
  close(answer.position!.value[0] + data.meta.origin_scene[0], expected.x);
  close(answer.position!.value[2] + data.meta.origin_scene[2], expected.z);
  const report = { passed: true, spec_version: spec.prompt_version, spec_sha256: build.output.sha256,
    source_frames: data.meta.frame_grid, vehicles: spec.objects.length, static_objects: spec.static_objects?.length,
    stored_rows: data.frames.length, pose_checks: poseChecks, source_provenance: Object.fromEntries(sources),
    contacts: data.meta.contacts, checkpoints: visibility,
    scope: "Real measured spec through viewer poses, disposable Mongo and actual assistant controller. Does not establish source identity/coverage or physical accuracy." };
  writeFileSync(new URL("./measured-clip-status.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(`Real measured integration passed: ${spec.objects.length} vehicles, ${data.frames.length} rows, ${poseChecks} poses, static zero motion, contact transforms, idempotent Mongo sync and assistant vector queries.`);
} finally {
  await client.close();
  await server.stop();
}
