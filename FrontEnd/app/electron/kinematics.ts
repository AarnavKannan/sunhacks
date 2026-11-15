/**
 * Per-frame kinematics database (MongoDB), in the Electron main process.
 *
 * One document per object per frame: position, velocity, speed, acceleration, heading,
 * yaw rate and net force, in the assistant's world frame (meters, +x east, +y up, -z north,
 * origin at the crash point). The renderer and the assistant read it; only `kinematics:sync`
 * writes, and that's called by the app, never by a model tool.
 *
 * Where it lives:
 *   - MONGODB_URI set (Atlas, a team server, a local mongod): that database.
 *   - otherwise an embedded mongod (mongodb-memory-server) storing its files in
 *     <userData>/mongo, so demos need no setup and the data survives restarts.
 *
 * Collections (database MONGODB_DB, default "reconstruct"):
 *   incidents  { _id, title, hash, fps, duration_s, origin_scene, crash, entities[], basis, physics, synced_at }
 *   frames     { incident_id, entity_id, t, rev (hash of the sync that wrote it), frame, position, velocity, speed, accel, accel_long,
 *                heading_deg, yaw_rate_dps, mass_kg, force_net, force_parts, force_reported,
 *                involvement, sigma }
 *   analyses   Gemini's reading of uploaded footage (electron/gemini.ts)
 *   scenes     Gemini scenes in the library: analysis id + seed, rebuilt by the engine at startup
 * The tracking pipeline's real output (tracks.json) is meant to be loaded through the same
 * sync call, with `sigma` filled in and basis "tracked from the footage".
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { App, IpcMain } from "electron";
import type { Collection, Db, MongoClient as MongoClientType } from "mongodb";

type Vec3 = [number, number, number];

export type FrameDoc = {
  incident_id: string;
  entity_id: string;
  t: number;
  frame: number;
  position: Vec3;
  velocity: Vec3;
  speed: number;
  accel: Vec3;
  /** Signed along the direction of travel; negative = slowing. */
  accel_long: number;
  /** Compass bearing of travel, 0 = north, 90 = east. */
  heading_deg: number;
  /** Compass bearing the body faces (played-back pose); heading_deg is the direction of travel. */
  body_heading_deg?: number;
  /** Positive = turning right (clockwise seen from above). */
  yaw_rate_dps: number;
  mass_kg: number;
  /** Net force = mass × acceleration, world frame (N). */
  force_net: Vec3;
  /** force_net split into tyre/road, air drag, rolling resistance, slope and impact (sums to force_net). */
  force_parts?: { tyre_road: Vec3; drag: Vec3; rolling: Vec3; grade: Vec3; contact: Vec3 };
  /** Gemini's own force reading near this time. */
  force_reported?: { vector: Vec3; cause: string; note: string } | null;
  involvement?: "crash" | "background";
  sigma: { position_m?: number; speed_mps?: number; accel_mps2?: number } | null;
  /** "vehicle" (default when absent) or "static" (a fixed object that never moves). */
  entity_kind?: "vehicle" | "static";
  /** Provenance of this sample: a spec keyframe's src, "interpolated", or "static". */
  src?: string;
  /** Ids of the objects this entity is touching at this frame. */
  contact_with?: string[];
  /** Content hash of the sync that wrote this row; rows with another (or no) rev are stale. */
  rev?: string;
};

export type IncidentDoc = {
  _id: string;
  title: string;
  hash: string;
  fps: number;
  duration_s: number;
  origin_scene: Vec3;
  crash: { start_s: number; end_s: number; vehicles: string[] } | null;
  entities: { id: string; label: string; type: string; mass_kg: number; from_s: number; to_s: number; involvement?: "crash" | "background"; kind?: "vehicle" | "static" }[];
  basis: string;
  caveats?: string[];
  physics?: { wind: Vec3; gradePercent: number; surface: string; mu: number; air_density: number };
  /** Derivation + source version; part of `hash`. */
  version?: string;
  frame_grid?: { fps: number; first_frame: number; last_frame: number; source: "video" | "preview" };
  /** Fixed collision objects and contacts, passed through as stored (see src/electron.d.ts). */
  static_objects?: unknown[];
  contacts?: unknown[];
  synced_at: Date;
};

type Status = { state: "starting" | "ready" | "error"; mode?: "embedded" | "external"; error?: string };

/** Above this jump between two frames (m) the object left and re-entered; don't blend across it. */
const TELEPORT_M = 15;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const lerpAngle = (a: number, b: number, k: number) => {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + d * k) % 360) + 360) % 360;
};
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function blend(a: FrameDoc, b: FrameDoc, t: number): FrameDoc {
  const nearer = t - a.t < b.t - t ? a : b;
  if (b.t === a.t || dist(a.position, b.position) > TELEPORT_M) return { ...nearer, t };
  const k = (t - a.t) / (b.t - a.t);
  // A value between observed frames is interpolated, never itself an observation.
  const src = a.src === b.src && a.src !== "measured" ? a.src
    : a.src !== undefined || b.src !== undefined ? "interpolated" : undefined;
  const out: FrameDoc = {
    ...a,
    t,
    frame: nearer.frame,
    position: lerp3(a.position, b.position, k),
    velocity: lerp3(a.velocity, b.velocity, k),
    speed: lerp(a.speed, b.speed, k),
    accel: lerp3(a.accel, b.accel, k),
    accel_long: lerp(a.accel_long, b.accel_long, k),
    heading_deg: lerpAngle(a.heading_deg, b.heading_deg, k),
    ...(a.body_heading_deg !== undefined && b.body_heading_deg !== undefined ? { body_heading_deg: lerpAngle(a.body_heading_deg, b.body_heading_deg, k) } : {}),
    yaw_rate_dps: lerp(a.yaw_rate_dps, b.yaw_rate_dps, k),
    force_net: lerp3(a.force_net, b.force_net, k),
    ...(a.force_parts && b.force_parts
      ? {
          force_parts: {
            tyre_road: lerp3(a.force_parts.tyre_road, b.force_parts.tyre_road, k),
            drag: lerp3(a.force_parts.drag, b.force_parts.drag, k),
            rolling: lerp3(a.force_parts.rolling, b.force_parts.rolling, k),
            grade: lerp3(a.force_parts.grade, b.force_parts.grade, k),
            contact: lerp3(a.force_parts.contact, b.force_parts.contact, k),
          },
        }
      : {}),
    force_reported: k < 0.5 ? a.force_reported : b.force_reported,
    sigma: a.sigma && b.sigma ? Object.fromEntries(
      (["position_m", "speed_mps", "accel_mps2"] as const).flatMap((key) => {
        const left = a.sigma?.[key];
        const right = b.sigma?.[key];
        const value = left !== undefined && right !== undefined ? lerp(left, right, k) : nearer.sigma?.[key];
        return value === undefined ? [] : [[key, value]];
      }),
    ) : nearer.sigma,
  };
  if (src !== undefined) out.src = src;
  else delete out.src;
  if (nearer.contact_with) out.contact_with = nearer.contact_with;
  else delete out.contact_with;
  return out;
}

/** Values at each requested time from frames sorted by t; null where the object has no data. */
export function sampleAt(frames: FrameDoc[], times: number[], fps: number, visible?: { from_s: number; to_s: number }): (FrameDoc | null)[] {
  return times.map((t) => {
    if (!Number.isFinite(t) || (visible && (t < visible.from_s - 1e-6 || t > visible.to_s + 1e-6))) return null;
    let hi = frames.findIndex((frame) => frame.t >= t);
    if (hi === -1) hi = frames.length;
    const after = frames[hi];
    const before = frames[hi - 1];
    if (after && Math.abs(after.t - t) < 1e-9) return { ...after, t };
    if (before && after) {
      // Hidden gaps have no rows: never manufacture a path across them.
      if (before.entity_kind !== "static" && after.t - before.t > 1.5 / fps) return null;
      return blend(before, after, t);
    }
    // Fixed objects never move: any stored row stands for all times.
    const fixed = after?.entity_kind === "static" ? after : before?.entity_kind === "static" ? before : null;
    if (fixed) return { ...fixed, t };
    const edge = before ?? after;
    // Only hold an edge inside the playback visibility window, never across its entry/exit.
    return edge && visible && Math.abs(edge.t - t) < 1 / fps + 1e-6 ? { ...edge, t } : null;
  });
}

const CHUNK = 5000;
/** One sync at a time per incident within this process. */
const syncChains = new Map<string, Promise<unknown>>();

/**
 * Replaces an incident's frames unless the stored copy already has this content hash.
 * Idempotent and safe to repeat or interrupt: rows are upserted by (incident, entity, t) and
 * tagged with `rev` = the hash, rows from any other revision are deleted afterwards, and the
 * incident document (which gates the no-op check) is written last.
 */
export function syncIncident(
  db: Db,
  meta: Omit<IncidentDoc, "synced_at">,
  rows: FrameDoc[],
): Promise<{ synced: boolean; frames: number; duplicates: number }> {
  const id = meta._id;
  const previous = syncChains.get(id) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => syncIncidentLocked(db, meta, rows));
  const tail = run.catch(() => undefined);
  syncChains.set(id, tail);
  void tail.then(() => {
    if (syncChains.get(id) === tail) syncChains.delete(id);
  });
  return run;
}

async function syncIncidentLocked(db: Db, meta: Omit<IncidentDoc, "synced_at">, rows: FrameDoc[]) {
  const id = meta._id;
  try {
    const incidentCol = db.collection<IncidentDoc>("incidents");
    const col = db.collection<FrameDoc>("frames");
    // Checked after taking the lock, so a queued identical sync is a no-op.
    const existing = await incidentCol.findOne({ _id: id }, { projection: { hash: 1 } });
    if (existing?.hash === meta.hash) return { synced: false, frames: 0, duplicates: 0 };

    assertFiniteNumbers(meta, `incident ${id}`);
    if (!(meta.fps > 0)) throw new Error("Frame rate must be positive.");
    const unique = new Map<string, FrameDoc>();
    const dupKeys: string[] = [];
    for (const input of rows) {
      assertFiniteNumbers(input, `${input.entity_id} frame ${input.frame}`);
      if (!Number.isInteger(input.frame) || input.frame < 0 || Math.abs(input.t - input.frame / meta.fps) > 1e-6) {
        throw new Error(`Invalid frame/time for ${input.entity_id}: frame ${input.frame}, t=${input.t}, fps=${meta.fps}.`);
      }
      // Canonical frame time prevents floating-point variants of f/fps becoming separate rows.
      const row = { ...input, t: Math.round(input.frame / meta.fps * 1e6) / 1e6 };
      const key = `${row.entity_id}\u0000${row.frame}`;
      if (unique.has(key)) dupKeys.push(`${row.entity_id}@${row.t}`);
      unique.set(key, row); // keep the last
    }
    if (dupKeys.length) {
      console.warn(`Kinematics sync for "${id}": ${dupKeys.length} duplicate (object, time) rows dropped, e.g. ${dupKeys.slice(0, 5).join(", ")}`);
    }

    const list = [...unique.values()];
    // Invalidate the no-op marker before changing rows. If a write is interrupted, the next
    // restore must rebuild even when it asks for the previous hash.
    await incidentCol.updateOne({ _id: id }, { $set: { hash: "" } });
    for (let i = 0; i < list.length; i += CHUNK) {
      const ops = list.slice(i, i + CHUNK).map((row) => {
        const doc = { ...row, incident_id: id, rev: meta.hash };
        return { replaceOne: { filter: { incident_id: id, entity_id: doc.entity_id, t: doc.t }, replacement: doc, upsert: true } };
      });
      await col.bulkWrite(ops, { ordered: false });
    }
    // Stale rows: another revision, or written by older code (no rev; $ne matches missing fields).
    await col.deleteMany({ incident_id: id, rev: { $ne: meta.hash } });
    await incidentCol.replaceOne({ _id: id }, { ...meta, synced_at: new Date() }, { upsert: true, writeConcern: { j: true } });
    return { synced: true, frames: list.length, duplicates: dupKeys.length };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Couldn't save the motion data for reconstruction "${id}" to the database: ${reason}`);
  }
}

function assertFiniteNumbers(value: unknown, path: string): void {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`Non-finite number in ${path}.`);
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) assertFiniteNumbers(child, `${path}.${key}`);
  }
}

export function registerKinematics({ ipcMain, app }: { ipcMain: IpcMain; app: App }) {
  let status: Status = { state: "starting" };
  let client: MongoClientType | null = null;
  let server: { stop: (opts?: { doCleanup?: boolean }) => Promise<boolean> } | null = null;

  const ready: Promise<Db> = (async () => {
    // Loaded at runtime from node_modules (kept out of the esbuild bundle).
    const { MongoClient } = await import("mongodb");
    let uri = process.env.MONGODB_URI;
    let mode: Status["mode"] = "external";
    if (!uri) {
      const { MongoMemoryServer } = await import("mongodb-memory-server");
      const dbPath = join(app.getPath("userData"), "mongo");
      mkdirSync(dbPath, { recursive: true });
      const embedded = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: "wiredTiger" } });
      server = embedded;
      uri = embedded.getUri();
      mode = "embedded";
    }
    client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 8000 });
    const db = client.db(process.env.MONGODB_DB ?? "reconstruct");
    // An index problem (e.g. old duplicate rows) must not take the whole database down.
    for (const [keys, options] of [
      [{ incident_id: 1, entity_id: 1, t: 1 }, { unique: true }],
      [{ incident_id: 1, t: 1 }, {}],
      [{ incident_id: 1, rev: 1 }, {}],
    ] as const) {
      try {
        await db.collection<FrameDoc>("frames").createIndex(keys, options);
      } catch (error) {
        console.error("Kinematics index couldn't be created; continuing without it", keys, error);
      }
    }
    status = { state: "ready", mode };
    return db;
  })();
  ready.catch((error: unknown) => {
    status = { state: "error", error: error instanceof Error ? error.message : String(error) };
    console.error("Kinematics database failed to start", error);
  });

  const frames = async () => (await ready).collection<FrameDoc>("frames");
  const incidents = async () => (await ready).collection<IncidentDoc>("incidents");

  const requireIncident = async (incidentId: string) => {
    await syncChains.get(incidentId);
    const meta = await (await incidents()).findOne({ _id: incidentId });
    if (!meta?.hash) throw new Error("This reconstruction has no complete per-frame motion data in the database; restore it to sync the frames again.");
    return meta;
  };

  const loadRange = async (col: Collection<FrameDoc>, incidentId: string, entityId: string, from: number, to: number) =>
    col
      .find({ incident_id: incidentId, entity_id: entityId, t: { $gte: from, $lte: to } }, { projection: { _id: 0, rev: 0 } })
      .sort({ t: 1 })
      .toArray();

  ipcMain.handle("kinematics:status", async () => status);

  /** Replaces an incident's frames unless the stored copy has the same content hash. */
  ipcMain.handle("kinematics:sync", async (_event, meta: Omit<IncidentDoc, "synced_at">, rows: FrameDoc[]) =>
    syncIncident(await ready, meta, rows),
  );

  ipcMain.handle("kinematics:incident", async (_event, incidentId: string) => requireIncident(incidentId));

  /** One object's values at each time (interpolated between frames); null where it has no data. */
  ipcMain.handle("kinematics:sample", async (_event, incidentId: string, entityId: string, times: number[]) => {
    const meta = await requireIncident(incidentId);
    const entity = meta.entities.find((entity) => entity.id === entityId);
    if (!entity) throw new Error(`No motion data for "${entityId}".`);
    if (!times.length) return [];
    const pad = 2 / meta.fps;
    const rows = await loadRange(await frames(), incidentId, entityId, Math.min(...times) - pad, Math.max(...times) + pad);
    return sampleAt(rows, times, meta.fps, entity);
  });

  /** Every object's position at one time, for distances and "what's near what". */
  ipcMain.handle("kinematics:positions", async (_event, incidentId: string, t: number) => {
    const meta = await requireIncident(incidentId);
    const pad = 2 / meta.fps;
    const col = await frames();
    const out: { entity_id: string; position: Vec3 }[] = [];
    for (const entity of meta.entities) {
      // Fixed objects have rows at every frame; any one of them gives the position.
      const rows =
        entity.kind === "static"
          ? await col.find({ incident_id: incidentId, entity_id: entity.id }, { projection: { _id: 0, rev: 0 } }).sort({ t: 1 }).limit(1).toArray()
          : await loadRange(col, incidentId, entity.id, t - pad, t + pad);
      const at = sampleAt(rows, [t], meta.fps, entity)[0];
      if (at) out.push({ entity_id: entity.id, position: at.position });
    }
    return out;
  });

  return {
    /** The database, for the Gemini module's analyses and scenes collections. */
    db: () => ready,
    dispose: async () => {
      try {
        // Flush to disk before the embedded server stops, so nothing is lost on Windows.
        if (client && server) await client.db("admin").command({ fsync: 1 });
        await client?.close();
        await server?.stop({ doCleanup: false });
      } catch (error) {
        console.error("Kinematics database didn't close cleanly", error);
      }
    },
  };
}
