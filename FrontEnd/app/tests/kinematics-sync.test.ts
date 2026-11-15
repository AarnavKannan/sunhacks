import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { sampleAt, syncIncident, type FrameDoc, type IncidentDoc } from "../electron/kinematics";

const v3 = (x: number, y = 0, z = 0): [number, number, number] => [x, y, z];
const row = (incident: string, entity: string, frame: number, extra: Partial<FrameDoc> = {}): FrameDoc => ({
  incident_id: incident, entity_id: entity, t: frame / 30, frame, position: v3(frame), velocity: v3(1), speed: 1,
  accel: v3(0), accel_long: 0, heading_deg: 0, yaw_rate_dps: 0, mass_kg: 1000, force_net: v3(0), sigma: null, ...extra,
});
const rowsFor = (incident: string, entities: string[], n: number) =>
  entities.flatMap((e) => Array.from({ length: n }, (_, i) => row(incident, e, i)));
const metaFor = (id: string, hash: string, entities: string[]): Omit<IncidentDoc, "synced_at"> => ({
  _id: id, title: id, hash, fps: 30, duration_s: 1, origin_scene: v3(0), crash: null, basis: "test",
  entities: entities.map((e) => ({ id: e, label: e, type: "car", mass_kg: 1000, from_s: 0, to_s: 1 })),
});

const server = await MongoMemoryServer.create();
const client = await MongoClient.connect(server.getUri());
const db = client.db("kin_test");
const frames = db.collection<FrameDoc>("frames");
const incidents = db.collection<IncidentDoc>("incidents");
await frames.createIndex({ incident_id: 1, entity_id: 1, t: 1 }, { unique: true });
const warn = console.warn;
let failed = false;
try {
  // 1. Old algorithm, two interleaved syncs of the same incident.
  let oldDeletes = 0;
  let releaseDeletes!: () => void;
  let afterDeletes: Promise<void>;
  const oldSync = async (meta: Omit<IncidentDoc, "synced_at">, rows: FrameDoc[]) => {
    const existing = await incidents.findOne({ _id: meta._id }, { projection: { hash: 1 } });
    if (existing?.hash === meta.hash) return;
    await frames.deleteMany({ incident_id: meta._id });
    if (++oldDeletes === 2) releaseDeletes();
    await afterDeletes;
    for (let i = 0; i < rows.length; i += 5000) await frames.insertMany(rows.slice(i, i + 5000).map((r) => ({ ...r })), { ordered: false });
    await incidents.replaceOne({ _id: meta._id }, { ...meta, synced_at: new Date() }, { upsert: true });
  };
  let oldError = "";
  for (let attempt = 0; attempt < 5 && !oldError; attempt++) {
    oldDeletes = 0;
    afterDeletes = new Promise<void>((resolve) => { releaseDeletes = resolve; });
    const id = `old${attempt}`;
    const rows = rowsFor(id, ["a", "b", "c"], 2000);
    const results = await Promise.allSettled([oldSync(metaFor(id, "h", ["a", "b", "c"]), rows), oldSync(metaFor(id, "h", ["a", "b", "c"]), rows)]);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (rejected) oldError = String(rejected.reason?.message ?? rejected.reason);
  }
  assert.match(oldError, /E11000/, "old algorithm should hit a duplicate-key error under concurrency");
  console.log(`1. old algorithm, 2 concurrent syncs -> ${oldError.slice(0, 140)}`);

  // 2. New: concurrent identical syncs.
  for (const n of [2, 5]) {
    const id = `same${n}`;
    const rows = rowsFor(id, ["a", "b", "c"], 2000);
    const results = await Promise.all(Array.from({ length: n }, () => syncIncident(db, metaFor(id, "h1", ["a", "b", "c"]), rows)));
    assert.equal(results.filter((r) => r.synced).length, 1);
    assert.equal(await frames.countDocuments({ incident_id: id }), 6000);
    assert.equal((await incidents.findOne({ _id: id }))?.hash, "h1");
  }
  console.log("2. 2 and 5 concurrent identical syncs: no error, 6000 rows, one real write");

  // 3. Different hashes concurrently.
  {
    const id = "diff";
    const p1 = syncIncident(db, metaFor(id, "v1", ["a", "b"]), rowsFor(id, ["a", "b"], 300));
    const p2 = syncIncident(db, metaFor(id, "v2", ["c", "d", "e"]), rowsFor(id, ["c", "d", "e"], 200));
    await Promise.all([p1, p2]);
    assert.equal((await incidents.findOne({ _id: id }))?.hash, "v2");
    assert.equal(await frames.countDocuments({ incident_id: id }), 600);
    assert.equal(await frames.countDocuments({ incident_id: id, rev: { $ne: "v2" } }), 0);
    assert.deepEqual((await frames.distinct("entity_id", { incident_id: id })).sort(), ["c", "d", "e"]);
  }
  console.log("3. concurrent v1/v2: only v2 rows remain, incident hash v2");

  // 4. Rows from old code (no rev) are removed.
  {
    const id = "legacy";
    await frames.insertMany(rowsFor(id, ["a", "zz"], 50));
    await incidents.insertOne({ ...metaFor(id, "old", ["a", "zz"]), synced_at: new Date() });
    const r = await syncIncident(db, metaFor(id, "new", ["a"]), rowsFor(id, ["a"], 50));
    assert.equal(r.synced, true);
    assert.equal(await frames.countDocuments({ incident_id: id }), 50);
    assert.equal(await frames.countDocuments({ incident_id: id, entity_id: "zz" }), 0);
  }
  console.log("4. legacy rows without rev removed");

  // 5. Duplicates in input.
  {
    const id = "dups";
    const rows = [...rowsFor(id, ["a"], 10), row(id, "a", 3, { speed: 99 }), row(id, "a", 3, { speed: 42 })];
    let warned = 0;
    console.warn = () => { warned++; };
    const r = await syncIncident(db, metaFor(id, "d1", ["a"]), rows);
    console.warn = warn;
    assert.deepEqual([r.synced, r.frames, r.duplicates], [true, 10, 2]);
    assert.equal(warned, 1);
    assert.equal((await frames.findOne({ incident_id: id, frame: 3 }))?.speed, 42, "last duplicate wins");
  }
  console.log("5. duplicate input rows deduped (2 reported, last kept, one warning)");

  // 6. Identical hash again is a no-op.
  {
    const id = "dups";
    const before = (await incidents.findOne({ _id: id }))?.synced_at;
    const r = await syncIncident(db, metaFor(id, "d1", ["a"]), rowsFor(id, ["a"], 10));
    assert.deepEqual(r, { synced: false, frames: 0, duplicates: 0 });
    assert.deepEqual((await incidents.findOne({ _id: id }))?.synced_at, before);
  }
  console.log("6. same hash -> synced:false, no writes");

  // 7. sampleAt.
  {
    const a = row("i", "a", 0, { src: "measured", contact_with: ["x"] });
    const b = row("i", "a", 1, { src: "interpolated" });
    const c = row("i", "a", 2, { src: "measured" });
    const exact = sampleAt([a, b, c], [1 / 30], 30)[0]!;
    assert.equal(exact.frame, 1);
    assert.equal(exact.src, "interpolated");
    const near0 = sampleAt([a, b], [0.25 / 30], 30)[0]!;
    assert.equal(near0.frame, 0);
    assert.equal(near0.src, "interpolated", "a between-frame value is never an observation");
    assert.deepEqual(near0.contact_with, ["x"]);
    assert.ok(Math.abs(near0.position[0] - 0.25) < 1e-9);
    const near3 = sampleAt([a, b], [0.75 / 30], 30)[0]!;
    assert.equal(near3.frame, 1);
    assert.equal(near3.src, "interpolated");
    assert.equal(near3.contact_with, undefined);
    const bothMeasured = sampleAt([a, { ...b, src: "measured" }], [0.5 / 30], 30)[0]!;
    assert.equal(bothMeasured.src, "interpolated");
    assert.equal(bothMeasured.frame, 1, "half-frame ties agree with Math.round(t * fps)");
    assert.equal(sampleAt([a, c], [1 / 30], 30)[0], null, "never blend across missing/hidden frames");
    assert.equal(sampleAt([a, b], [-0.01, b.t + 0.01], 30).every((r) => r === null), true, "no ghost vehicle outside playback visibility");
    const wall = row("i", "wall", 0, { entity_kind: "static", src: "static", position: v3(5, 0, 5) });
    const s = sampleAt([wall, { ...wall, frame: 10, t: 10 / 30 }], [4 / 30, 99], 30);
    assert.deepEqual(s[0]!.position, wall.position);
    assert.equal(s[0]!.t, 4 / 30);
    assert.equal(s[0]!.src, "static");
    assert.equal(s[1]!.t, 99);
    assert.equal(sampleAt([a, c], [100], 30)[0], null);
  }
  console.log("7. sampleAt: exact, nearer frame/src, static rows OK");

  // 8. Two representations of the same video frame produce exactly one canonical time key.
  {
    const id = "float-time";
    const rows = [row(id, "a", 3), row(id, "a", 3, { t: 0.1 + Number.EPSILON, speed: 42 })];
    console.warn = () => undefined;
    const out = await syncIncident(db, metaFor(id, "h1", ["a"]), rows);
    console.warn = warn;
    assert.equal(out.duplicates, 1);
    assert.equal(await frames.countDocuments({ incident_id: id }), 1);
    assert.equal((await frames.findOne({ incident_id: id }))?.t, 0.1);
  }

  // 9. Bad input is rejected before any existing data or completion marker is changed.
  {
    const id = "float-time";
    await assert.rejects(syncIncident(db, metaFor(id, "bad", ["a"]), [row(id, "a", 0, { speed: NaN })]), /Non-finite/);
    await assert.rejects(syncIncident(db, metaFor(id, "bad", ["a"]), [row(id, "a", 0, { t: 1 })]), /Invalid frame\/time/);
    assert.equal((await incidents.findOne({ _id: id }))?.hash, "h1");
  }

  // 10. Interrupted replacement cannot leave an old hash claiming partially changed rows are current.
  {
    const id = "interrupted";
    const original = rowsFor(id, ["a"], 10);
    await syncIncident(db, metaFor(id, "old", ["a"]), original);
    const failingDb = {
      collection(name: string) {
        if (name !== "frames") return db.collection(name);
        return { async bulkWrite(ops: Parameters<typeof frames.bulkWrite>[0]) {
          await frames.bulkWrite(ops);
          throw new Error("simulated interrupted write");
        } };
      },
    } as unknown as typeof db;
    await assert.rejects(syncIncident(failingDb, metaFor(id, "new", ["a"]), original.map((r) => ({ ...r, speed: 99 }))), /simulated interrupted/);
    assert.equal((await incidents.findOne({ _id: id }))?.hash, "");
    assert.equal((await syncIncident(db, metaFor(id, "old", ["a"]), original)).synced, true);
    assert.equal(await frames.countDocuments({ incident_id: id, speed: 99 }), 0);
    assert.equal((await incidents.findOne({ _id: id }))?.hash, "old");
  }
  console.log("8–10. float-time deduplication, finite/frame validation and interrupted-sync recovery passed");
  console.log("All kinematics sync tests passed");
} catch (error) {
  console.warn = warn;
  console.error(error);
  failed = true;
} finally {
  await client.close();
  await server.stop();
}
process.exit(failed ? 1 : 0);
