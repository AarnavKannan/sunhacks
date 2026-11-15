/**
 * The app's implementation of the assistant's SceneController (packages/assistant/src/controller.ts).
 *
 * Every MCP tool, the fast path and the API-key adapters end up here, so the assistant can
 * only do what these functions allow: navigate, query the scene description, annotate and
 * export. Nothing here can change the reconstruction.
 *
 * Coordinates: the assistant's world frame is meters with +x east, +y up, -z north and the
 * origin at the crash point. The three.js scene uses the same axes but its own origin, so
 * every point crossing this boundary is shifted by `origin()`.
 *
 * Per-frame kinematics (positions, speeds, accelerations, forces) come from the MongoDB
 * frames collection in the main process (electron/kinematics.ts, src/kinematics/*), never
 * from the renderer's animation, so the assistant reports exactly what's stored.
 */
import type { SceneController } from "@assistant/controller";
import { computeCrashForces } from "@assistant/crash-forces";
import { matchEntities } from "@assistant/entity-match";
import {
  CAMERA_PRESETS,
  type CameraPreset,
  type CameraState,
  type ContactInfo,
  type ContactsReport,
  type CrashPhase,
  type Entity,
  type ExportJob,
  type FrameGrid,
  type KinematicsField,
  type KinematicsReading,
  type KinematicsSeries,
  type LibraryState,
  type Marker as AssistantMarker,
  type MeasureTarget,
  type SceneEvent,
  type SceneSummary,
  type SeekRequest,
  type StaticObjectInfo,
  type TimelineState,
  type TimeRef,
  type ToggleTarget,
  type Vec3,
} from "@assistant/types";
import type { SceneInfo } from "@/data/scenes";
import type { KinematicsFrame, KinematicsIncident, KinStaticObject, KinVec3 } from "@/electron.d";
import { crashOrigin } from "@/kinematics/derive";
import { incidentMeta, sampleKinematics } from "@/kinematics/store";
import { startExport } from "@/lib/exportVideo";
import { whenSceneReady } from "@/scene/activeScene";
import type { Point3, SceneHandle } from "@/scene/mountScene";
import { MAX_SPEED, MIN_SPEED, useAppStore } from "@/store/useAppStore";

const RAD = Math.PI / 180;
const DEFAULT_FOCUS_DISTANCE = 12;
const FOLLOW_DISTANCE = 18;

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
const MAX_SERIES_SAMPLES = 61;

const EVENT_ALIASES: Record<string, string> = {
  impact: "crash_start",
  crash: "crash_start",
  collision: "crash_start",
  hit: "crash_start",
  crash_start: "crash_start",
  start_of_crash: "crash_start",
  crash_end: "crash_end",
  end_of_crash: "crash_end",
  rest: "crash_end",
};

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r3 = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])];

const store = () => useAppStore.getState();

function openScene(): SceneInfo {
  const state = store();
  if (state.view !== "viewer") {
    throw new Error("No incident is open. The user is on the home screen; open one from the library first.");
  }
  const scene = state.scenes.find((item) => item.id === state.selectedId);
  if (!scene) throw new Error("No incident is open. The user is on the home screen; open one from the library first.");
  return scene;
}

function phaseAt(scene: SceneInfo, t: number): CrashPhase | null {
  if (scene.impactTime == null) return null;
  if (t < scene.impactTime) return "before_crash";
  if (scene.crashEnd == null || t <= scene.crashEnd) return "during_crash";
  return "after_crash";
}

function events(scene: SceneInfo): SceneEvent[] {
  const out: SceneEvent[] = [];
  if (scene.impactTime != null) {
    out.push({ t: scene.impactTime, type: "crash_start", vehicles: scene.crashVehicles, note: "First contact between the vehicles" });
  }
  if (scene.crashEnd != null) {
    out.push({ t: scene.crashEnd, type: "crash_end", vehicles: scene.crashVehicles, note: "End of the reconstructed crash sequence; hidden final motion may remain uncertain" });
  }
  return out;
}

function eventTime(scene: SceneInfo, name: string): number {
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const type = EVENT_ALIASES[key] ?? key;
  const event = events(scene).find((item) => item.type === type);
  if (!event) {
    const known = events(scene).map((item) => item.type);
    throw new Error(known.length ? `No "${name}" event. Events in this reconstruction: ${known.join(", ")}.` : "This reconstruction has no crash or other events.");
  }
  return event.t;
}

/** Last frame grid seen per scene, so the synchronous timeline() can report frame and fps. */
const gridCache = new Map<string, FrameGrid | null>();

/** The incident's stored metadata; remembers its frame grid. Throws when the database is unavailable. */
async function meta(scene: SceneInfo): Promise<KinematicsIncident> {
  const m = await incidentMeta(scene);
  gridCache.set(scene.id, m.frame_grid ?? null);
  return m;
}

/** Same, but null instead of throwing (for summaries that must work without the database). */
async function metaOrNull(scene: SceneInfo): Promise<KinematicsIncident | null> {
  try {
    return await meta(scene);
  } catch {
    return null;
  }
}

/** Source video frame index nearest to t on a video grid (clamped to the stored frames), else undefined. */
function frameAt(grid: FrameGrid | null | undefined, t: number): number | undefined {
  if (!grid || grid.source !== "video") return undefined;
  return Math.max(grid.first_frame, Math.min(grid.last_frame, Math.round(t * grid.fps)));
}

async function resolveTime(scene: SceneInfo, at: TimeRef | undefined): Promise<number> {
  if (!at) return store().time;
  let t: number;
  if ("t_s" in at) t = at.t_s;
  else if ("frame" in at) {
    const grid = (await meta(scene)).frame_grid;
    if (!grid || grid.source !== "video") {
      throw new Error("This reconstruction has no source video frame grid, so frame numbers can't be converted to time. Use seconds instead.");
    }
    if (!Number.isInteger(at.frame) || at.frame < grid.first_frame || at.frame > grid.last_frame) {
      throw new Error(`Frame ${at.frame} is outside the footage (frames ${grid.first_frame} to ${grid.last_frame}).`);
    }
    t = at.frame / grid.fps;
  } else t = eventTime(scene, at.event) + (at.offset_s ?? 0);
  if (!Number.isFinite(t) || t < 0 || t > scene.duration) {
    throw new Error(`That's ${round(t)} s, outside the footage (0 to ${scene.duration} s).`);
  }
  return t;
}

function timeline(scene: SceneInfo): TimelineState {
  const state = store();
  const grid = gridCache.get(scene.id);
  const frame = frameAt(grid, state.time);
  return {
    t_s: round(state.time, 3),
    duration_s: scene.duration,
    playing: state.playing,
    speed: state.speed,
    t_rel_crash_s: scene.impactTime == null ? null : round(state.time - scene.impactTime, 3),
    phase: phaseAt(scene, state.time),
    ...(frame !== undefined && grid ? { frame, fps: grid.fps } : {}),
  };
}

/** The crash point in scene coordinates (shared with the stored kinematics). */
function origin(scene: SceneInfo): Vec3 {
  return crashOrigin(scene);
}

const toWorld = (p: Point3, o: Vec3): Vec3 => r3(sub(p, o));
const toScene = (p: Vec3, o: Vec3): Point3 => add(p, o);

function vehicleEntities(scene: SceneInfo): Entity[] {
  return scene.vehicles.map((vehicle) => {
    const color = vehicle.label.split(/[\s-]/)[0]?.toLowerCase();
    return {
      id: vehicle.id,
      label: vehicle.label,
      color,
      type: vehicle.type,
      aliases: vehicle.aliases,
      kind: "vehicle" as const,
      ...(vehicle.involvement ? { involvement: vehicle.involvement } : {}),
      ...(vehicle.visibleFrom != null ? { visible_from_s: round(vehicle.visibleFrom, 2) } : {}),
      ...(vehicle.visibleTo != null ? { visible_to_s: round(vehicle.visibleTo, 2) } : {}),
    };
  });
}

/** Fixed objects (the median divider) as entities of kind "static". */
function staticEntities(m: KinematicsIncident | null): Entity[] {
  if (!m) return [];
  const out: Entity[] = [];
  const seen = new Set<string>();
  for (const object of m.static_objects ?? []) {
    const e = m.entities.find((x) => x.id === object.id);
    seen.add(object.id);
    out.push({
      id: object.id,
      label: object.label,
      type: object.kind,
      kind: "static",
      aliases: [object.id.replace(/[-_]/g, " ")],
      ...(e ? { visible_from_s: round(e.from_s, 2), visible_to_s: round(e.to_s, 2) } : {}),
    });
  }
  for (const e of m.entities) {
    if (e.kind === "static" && !seen.has(e.id)) {
      out.push({ id: e.id, label: e.label, type: e.type, kind: "static", aliases: [e.id.replace(/[-_]/g, " ")], visible_from_s: round(e.from_s, 2), visible_to_s: round(e.to_s, 2) });
    }
  }
  return out;
}

async function allEntities(scene: SceneInfo, m?: KinematicsIncident | null): Promise<Entity[]> {
  return [...vehicleEntities(scene), ...staticEntities(m === undefined ? await metaOrNull(scene) : m)];
}

/** A vehicle of the scene (camera and view methods need one). */
function requireVehicle(scene: SceneInfo, id: string) {
  const vehicle = scene.vehicles.find((item) => item.id === id);
  if (!vehicle) {
    const known = scene.vehicles.map((item) => `${item.id} (${item.label})`).join(", ");
    throw new Error(known ? `No vehicle with id "${id}". Vehicles: ${known}.` : "This reconstruction has no tracked vehicles.");
  }
  return vehicle;
}

type ResolvedEntity = { id: string; label: string; type: string; kind: "vehicle" | "static"; object?: KinStaticObject };

/** A vehicle or a fixed object by id (for the data tools). */
async function requireEntity(scene: SceneInfo, id: string): Promise<ResolvedEntity> {
  const vehicle = scene.vehicles.find((item) => item.id === id);
  if (vehicle) return { id, label: vehicle.label, type: vehicle.type, kind: "vehicle" };
  const m = await metaOrNull(scene);
  const object = m?.static_objects?.find((item) => item.id === id);
  const staticEntity = m?.entities.find((item) => item.id === id && item.kind === "static");
  if (object || staticEntity) {
    return { id, label: object?.label ?? staticEntity!.label, type: object?.kind ?? staticEntity!.type, kind: "static", ...(object ? { object } : {}) };
  }
  const known = [...scene.vehicles.map((item) => `${item.id} (${item.label})`), ...staticEntities(m).map((item) => `${item.id} (${item.label}, fixed)`)].join(", ");
  throw new Error(known ? `No vehicle or object with id "${id}". Known: ${known}.` : "This reconstruction has no tracked vehicles.");
}

async function context() {
  const scene = openScene();
  const handle = await whenSceneReady();
  return { scene, handle, o: origin(scene) };
}

function cameraState(handle: SceneHandle, o: Vec3, clamped = false): CameraState {
  const pose = handle.getCamera();
  const state = store();
  return {
    position: toWorld(pose.position, o),
    target: toWorld(pose.target, o),
    distance_m: round(len(sub(pose.position, pose.target))),
    following: state.following,
    pov: state.pov,
    clamped,
  };
}

/** Moves the camera in scene coordinates and reports the result in world coordinates. */
function commit(handle: SceneHandle, o: Vec3, position: Vec3, target: Vec3, keepFollow = false): CameraState {
  store().setCameraMode({ pov: null, ...(keepFollow ? {} : { following: null }) });
  const placed = handle.setCamera({ position, target });
  return cameraState(handle, o, placed.clamped);
}

function angles(handle: SceneHandle) {
  const pose = handle.getCamera();
  const d = sub(pose.position, pose.target);
  const r = len(d) || 1;
  return { yaw: Math.atan2(d[0], d[2]) / RAD, pitch: Math.asin(d[1] / r) / RAD, distance: r, target: pose.target, position: pose.position };
}

/** Camera position around `target`: yaw 0 = south of it looking north, 90 = east; pitch 90 = above. */
function around(target: Vec3, distance: number, yawDeg: number, pitchDeg: number): Vec3 {
  const yaw = yawDeg * RAD;
  const pitch = Math.max(-89.9, Math.min(89.9, pitchDeg)) * RAD;
  return [
    target[0] + distance * Math.cos(pitch) * Math.sin(yaw),
    target[1] + distance * Math.sin(pitch),
    target[2] + distance * Math.cos(pitch) * Math.cos(yaw),
  ];
}

function vehiclePoint(handle: SceneHandle, id: string): Vec3 {
  const state = store();
  let t = state.time;
  let pose = handle.vehiclePose(id, t);
  if (!pose) throw new Error(`Vehicle "${id}" isn't in the 3D scene.`);
  if (pose.hidden) {
    // Before it drives in or after it leaves there's nothing on screen to point the camera at
    // (its held pose is off at the edge of view): jump to the nearest moment it's on the road.
    const vehicle = state.scenes.find((s) => s.id === state.selectedId)?.vehicles.find((v) => v.id === id);
    if (vehicle?.visibleFrom != null && vehicle.visibleTo != null) {
      t = Math.min(Math.max(t, vehicle.visibleFrom), vehicle.visibleTo);
      state.setTime(t);
      pose = handle.vehiclePose(id, t) ?? pose;
    }
    if (pose.hidden) throw new Error(`The ${vehicle?.label ?? id} isn't in the scene at ${state.time.toFixed(1)} s.`);
  }
  return add(pose.position, [0, 0.8, 0]);
}

/** A vehicle's current point, or a fixed object's centroid (mid-height) as a scene point. */
async function cameraPoint(scene: SceneInfo, handle: SceneHandle, o: Vec3, id: string): Promise<Vec3> {
  const entity = await requireEntity(scene, id);
  if (entity.kind === "vehicle") return vehiclePoint(handle, id);
  const object = entity.object;
  if (!object) throw new Error(`The ${entity.label} has no stored geometry to point the camera at.`);
  return toScene(add(object.centroid, [0, object.height_m / 2, 0]), o);
}

/** Follow and POV only make sense for something that moves. */
async function requireMoving(scene: SceneInfo, id: string, what: "follow" | "pov") {
  const entity = await requireEntity(scene, id);
  if (entity.kind === "static") {
    throw new Error(`The ${entity.label} is a fixed object, so the camera can't ${what === "follow" ? "follow it" : "ride in it"}. Use camera_focus to look at it instead.`);
  }
  requireVehicle(scene, id);
}

function reading(scene: SceneInfo, frame: KinematicsFrame, fields: KinematicsField[], basis: string, type: string, grid?: FrameGrid | null): KinematicsReading {
  const want = new Set<KinematicsField>(fields.length ? fields : ["speed", "acceleration", "heading"]);
  const sigma = frame.sigma ?? {};
  const out: KinematicsReading = {
    entity_id: frame.entity_id,
    t_s: round(frame.t, 3),
    t_rel_crash_s: scene.impactTime == null ? null : round(frame.t - scene.impactTime, 3),
    phase: phaseAt(scene, frame.t),
    source: "reconstruction",
    basis,
  };
  const isStatic = frame.entity_kind === "static";
  const storedFrame = grid?.source === "video" ? frame.frame : undefined;
  if (storedFrame !== undefined) out.frame = storedFrame;
  if (frame.src) out.src = frame.src;
  if (frame.entity_kind) out.entity_kind = frame.entity_kind;
  if (frame.contact_with) out.contact_with = frame.contact_with;
  if (want.has("position")) {
    out.position = { value: [...frame.position], unit: "m", ...(sigma.position_m !== undefined ? { sigma_m: round(sigma.position_m) } : {}) };
  }
  if (want.has("velocity")) out.velocity = { value: [...frame.velocity], unit: "m/s" };
  if (want.has("speed")) {
    const s = sigma.speed_mps;
    out.speed = {
      mps: { value: round(frame.speed), unit: "m/s", ...(s !== undefined ? { sigma: round(s) } : {}) },
      mph: { value: round(frame.speed * 2.23694, 1), unit: "mph", ...(s !== undefined ? { sigma: round(s * 2.23694, 1) } : {}) },
      kmh: { value: round(frame.speed * 3.6, 1), unit: "km/h", ...(s !== undefined ? { sigma: round(s * 3.6, 1) } : {}) },
    };
  }
  if (want.has("acceleration")) {
    out.acceleration = {
      value: round(frame.accel_long),
      unit: "m/s²",
      g: round(frame.accel_long / 9.80665),
      vector: [...frame.accel],
      ...(sigma.accel_mps2 !== undefined ? { sigma: round(sigma.accel_mps2) } : {}),
    };
  }
  if (want.has("heading")) {
    out.heading = { value: round(frame.heading_deg, 1), unit: "deg", compass: COMPASS[Math.round(frame.heading_deg / 45) % 8]! };
    if (frame.body_heading_deg !== undefined) {
      out.body_heading = { value: round(frame.body_heading_deg, 1), unit: "deg", compass: COMPASS[Math.round(frame.body_heading_deg / 45) % 8]! };
    }
  }
  if (want.has("yaw_rate")) out.yaw_rate = { value: round(frame.yaw_rate_dps, 1), unit: "deg/s" };
  if (want.has("forces")) {
    const q = (v: KinVec3) => ({ vector: [...v] as Vec3, magnitude: { value: Math.round(len(v)), unit: "N" } });
    const parts = frame.force_parts;
    out.forces = {
      mass_kg: frame.mass_kg,
      net: q(frame.force_net),
      ...(parts
        ? { parts: { tyre_road: q(parts.tyre_road), drag: q(parts.drag), rolling: q(parts.rolling), grade: q(parts.grade), contact: q(parts.contact) } }
        : {}),
      ...(frame.force_reported
        ? { reported: { ...q(frame.force_reported.vector), cause: frame.force_reported.cause, note: frame.force_reported.note } }
        : {}),
      model: isStatic
        ? "fixed object: immovable, net force is zero at every moment; contact reactions are taken by the ground and structure"
        : parts
        ? `net force = mass × acceleration (${frame.mass_kg} kg, estimated ${type}); split into tyre/road, air drag (with wind), rolling resistance, slope and impact using standard coefficients`
        : `net force = mass × acceleration, using a nominal ${frame.mass_kg} kg for a ${type}; air drag and friction not modeled separately`,
    };
  }
  return out;
}

async function kinematicsAt(scene: SceneInfo, entityId: string, t: number) {
  const entity = await requireEntity(scene, entityId);
  const [frame] = await sampleKinematics(scene, entityId, [t]);
  if (!frame) throw new Error(`The ${entity.label} isn't in the scene at ${round(t)} s.`);
  return frame;
}

function library(): LibraryState {
  const state = store();
  const folders = new Map<string, LibraryState["folders"][number]>();
  for (const scene of state.scenes) {
    const folder = folders.get(scene.folder) ?? { name: scene.folder, incidents: [] };
    folder.incidents.push({ id: scene.id, title: scene.title, duration_s: scene.duration, created: scene.created });
    folders.set(scene.folder, folder);
  }
  return { folders: [...folders.values()], open: state.view === "viewer" ? state.selectedId : null };
}

function staticObjectInfos(m: KinematicsIncident): StaticObjectInfo[] {
  return (m.static_objects ?? []).map((o) => ({ ...o }));
}

function contactInfos(m: KinematicsIncident): ContactInfo[] {
  return (m.contacts ?? []).map(({ t, ...c }) => ({ ...c, t_s: t }));
}

/** Notes for the user about contacts that are inferred or whose stored impulse disagrees with the stored vectors. */
function contactCaveats(contacts: ContactInfo[]): string[] {
  const out: string[] = [];
  for (const c of contacts) {
    const name = `${c.a} → ${c.b}`;
    if (c.source === "inferred") out.push(`The ${name} contact is inferred, not directly seen in the footage.`);
    if (c.impulse_ns != null && c.impulse_ns !== 0) {
      for (const d of c.derived) {
        const along = Math.abs(d.along_normal_ns);
        if (Math.abs(along - Math.abs(c.impulse_ns)) / Math.abs(c.impulse_ns) > 0.3) {
          out.push(
            `${name}: the stated impulse is ${Math.round(Math.abs(c.impulse_ns))} N·s, but ${d.entity_id}'s mass × change in velocity along the contact normal is ${Math.round(along)} N·s (over ${d.window_s} s); they differ by more than 30%.`,
          );
        }
      }
    }
  }
  return out;
}

async function summary(): Promise<SceneSummary> {
  const { scene, handle, o } = await context();
  const bounds = handle.bounds();
  const m = await metaOrNull(scene);
  const statics = m ? staticObjectInfos(m) : [];
  const contacts = m ? contactInfos(m) : [];
  return {
    incident_id: scene.id,
    title: scene.title,
    duration_s: scene.duration,
    entities: await allEntities(scene, m),
    events: events(scene),
    crash:
      scene.impactTime == null
        ? null
        : { start_s: scene.impactTime, end_s: scene.crashEnd ?? scene.impactTime, vehicles: scene.crashVehicles },
    bounds: { min: toWorld(bounds.min, o), max: toWorld(bounds.max, o) },
    source_videos: scene.sourceVideo ? 1 : 0,
    timeline: timeline(scene),
    camera: cameraState(handle, o),
    ...(statics.length ? { static_objects: statics } : {}),
    ...(contacts.length ? { contacts } : {}),
    ...(m?.frame_grid ? { frame_grid: m.frame_grid } : {}),
    ...(m ? { basis: m.basis, caveats: m.caveats ?? [] } : {}),
  };
}

export const appSceneController: SceneController = {
  async listLibrary() {
    return library();
  },

  async openIncident(incidentId) {
    const scene = store().scenes.find((item) => item.id === incidentId || item.title.toLowerCase() === incidentId.toLowerCase());
    if (!scene) throw new Error(`No reconstruction "${incidentId}" in the library.`);
    store().openScene(scene.id);
    return summary();
  },

  async closeIncident() {
    store().closeScene();
    return library();
  },

  describe: summary,

  async findEntities(query) {
    const scene = openScene();
    return matchEntities(await allEntities(scene), query);
  },

  async focus(entityId, distanceM = DEFAULT_FOCUS_DISTANCE) {
    const { scene, handle, o } = await context();
    const target = await cameraPoint(scene, handle, o, entityId);
    const { yaw, pitch } = angles(handle);
    const keep = store().following === entityId;
    return commit(handle, o, around(target, distanceM, yaw, Math.max(pitch, 15)), target, keep);
  },

  async panTo(target) {
    const { scene, handle, o } = await context();
    let point: Vec3;
    if ("entity_id" in target) {
      point = await cameraPoint(scene, handle, o, target.entity_id);
    } else {
      point = toScene(target.point, o);
    }
    const pose = handle.getCamera();
    const delta = sub(point, pose.target);
    return commit(handle, o, add(pose.position, delta), point);
  },

  async orbit(yawDeg, pitchDeg) {
    const { handle, o } = await context();
    const { yaw, pitch, distance, target } = angles(handle);
    return commit(handle, o, around(target, distance, yaw + yawDeg, pitch + pitchDeg), target, true);
  },

  async rotate(yawDeg, pitchDeg) {
    const { handle, o } = await context();
    const pose = handle.getCamera();
    // View direction is camera → target; swing the target around the camera.
    const dir = sub(pose.target, pose.position);
    const r = len(dir) || 1;
    const yaw = Math.atan2(dir[0], dir[2]) - yawDeg * RAD; // positive = look right (clockwise from above)
    const pitch = Math.max(-89 * RAD, Math.min(89 * RAD, Math.asin(dir[1] / r) + pitchDeg * RAD));
    const target = add(pose.position, [r * Math.cos(pitch) * Math.sin(yaw), r * Math.sin(pitch), r * Math.cos(pitch) * Math.cos(yaw)]);
    return commit(handle, o, pose.position, target);
  },

  async move(rightM, upM, forwardM) {
    const { handle, o } = await context();
    const pose = handle.getCamera();
    const fwd = norm(sub(pose.target, pose.position));
    let right = cross(fwd, [0, 1, 0]);
    right = len(right) < 1e-6 ? [1, 0, 0] : norm(right);
    const up = norm(cross(right, fwd));
    const delta = add(add(scale(right, rightM), scale(up, upM)), scale(fwd, forwardM));
    return commit(handle, o, add(pose.position, delta), add(pose.target, delta));
  },

  async zoom(opts) {
    const { handle, o } = await context();
    const { yaw, pitch, distance, target } = angles(handle);
    const next = opts.distance_m ?? distance / (opts.factor ?? 1.5);
    return commit(handle, o, around(target, Math.max(1, next), yaw, pitch), target, true);
  },

  async setCamera(opts) {
    const { handle, o } = await context();
    const pose = handle.getCamera();
    const position = opts.position ? toScene(opts.position, o) : pose.position;
    const target = opts.target ? toScene(opts.target, o) : pose.target;
    return commit(handle, o, position, target);
  },

  async preset(preset: CameraPreset) {
    const { handle, o } = await context();
    const view = CAMERA_PRESETS[preset];
    if (!view) throw new Error(`Unknown view "${preset}". Use ${Object.keys(CAMERA_PRESETS).join(", ")}.`);
    const { distance, target } = angles(handle);
    return commit(handle, o, around(target, distance, view.yaw_deg, view.pitch_deg), target);
  },

  async follow(entityId) {
    const { scene, handle, o } = await context();
    if (entityId) {
      await requireMoving(scene, entityId, "follow");
      const { yaw, pitch, distance } = angles(handle);
      const target = vehiclePoint(handle, entityId);
      // Bring it into frame first if the camera is far away.
      const d = distance > 45 ? FOLLOW_DISTANCE : distance;
      store().setCameraMode({ following: null, pov: null });
      handle.setCamera({ position: around(target, d, yaw, Math.max(pitch, 15)), target });
    }
    store().setCameraMode({ following: entityId, pov: null });
    return cameraState(handle, o);
  },

  async pov(entityId) {
    const { scene, handle, o } = await context();
    if (entityId) {
      await requireMoving(scene, entityId, "pov");
      vehiclePoint(handle, entityId); // seeks into the time it's on the road, if it isn't now
    }
    store().setCameraMode({ pov: entityId, following: null });
    handle.render();
    return cameraState(handle, o);
  },

  async resetView() {
    const { handle, o } = await context();
    store().resetCamera();
    return cameraState(handle, o);
  },

  async seek(req: SeekRequest) {
    const scene = openScene();
    const state = store();
    if ("relative_s" in req) state.setTime(state.time + req.relative_s);
    else state.setTime(await resolveTime(scene, req));
    return timeline(scene);
  },

  async play(speed) {
    const scene = openScene();
    if (speed !== undefined && (speed < MIN_SPEED || speed > MAX_SPEED)) {
      throw new Error(`Playback speed must be between ${MIN_SPEED}× and ${MAX_SPEED}×.`);
    }
    const state = store();
    if (speed !== undefined) state.setSpeed(speed);
    if (!state.playing) state.togglePlay();
    return timeline(scene);
  },

  async pause() {
    const scene = openScene();
    store().setPlaying(false);
    return timeline(scene);
  },

  async queryKinematics(entityId, at, fields) {
    const scene = openScene();
    const entity = await requireEntity(scene, entityId);
    const m = await meta(scene);
    const t = await resolveTime(scene, at);
    const frame = await kinematicsAt(scene, entityId, t);
    return reading(scene, frame, fields, m.basis, entity.type, m.frame_grid);
  },

  async querySeries(entityId, fromS, toS, stepS, fields): Promise<KinematicsSeries> {
    const scene = openScene();
    const vehicle = await requireEntity(scene, entityId);
    const m = await meta(scene);
    const from = Math.max(0, fromS);
    const to = Math.min(scene.duration, toS);
    if (to < from) throw new Error(`That window is outside the footage (0 to ${scene.duration} s).`);
    const times: number[] = [];
    for (let i = 0; i < MAX_SERIES_SAMPLES && from + i * stepS <= to + 1e-9; i++) times.push(round(from + i * stepS, 6));
    const frames = await sampleKinematics(scene, entityId, times);
    const samples = frames.filter((frame) => frame !== null).map((frame) => reading(scene, frame, fields, m.basis, vehicle.type, m.frame_grid));
    if (!samples.length) throw new Error(`The ${vehicle.label} isn't in the scene between ${round(from)} and ${round(to)} s.`);
    return { entity_id: entityId, step_s: stepS, samples };
  },

  async crashForces() {
    const scene = openScene();
    if (scene.impactTime == null || scene.crashVehicles.length === 0) throw new Error("This reconstruction has no crash.");
    const m = await meta(scene);
    const crash = { start_s: scene.impactTime, end_s: scene.crashEnd ?? scene.impactTime, vehicles: scene.crashVehicles };
    const out = await computeCrashForces({
      crash,
      vehicles: scene.vehicles.map((vehicle) => ({
        id: vehicle.id,
        label: vehicle.label,
        mass_kg: m.entities.find((entity) => entity.id === vehicle.id)?.mass_kg ?? 1500,
      })),
      sample: async (entityId, times) =>
        (await sampleKinematics(scene, entityId, times)).map((frame) =>
          frame ? { position: frame.position, tyre: frame.force_parts?.tyre_road, reported: frame.force_reported ?? null } : null,
        ),
      basis: m.basis,
    });
    out.caveats.push(...(m.caveats ?? []));
    const recorded = contactInfos(m).filter((c) => c.impulse_ns != null);
    if (recorded.length) {
      out.caveats.push(
        `The reconstruction also records contact impulses (query_contacts): ${recorded.map((c) => `${c.a} → ${c.b} ${Math.round(c.impulse_ns!)} N·s`).join("; ")}.`,
      );
    }
    return out;
  },

  async queryContacts(): Promise<ContactsReport> {
    const scene = openScene();
    const m = await meta(scene);
    const contacts = contactInfos(m);
    const statics = staticObjectInfos(m);
    if (!contacts.length && !statics.length) throw new Error("This reconstruction has no recorded contacts.");
    return { contacts, static_objects: statics, frame_grid: m.frame_grid ?? null, basis: m.basis, caveats: [...(m.caveats ?? []), ...contactCaveats(contacts)] };
  },

  async measureDistance(a: MeasureTarget, b: MeasureTarget, at?: TimeRef) {
    const scene = openScene();
    const t = await resolveTime(scene, at);
    const point = async (target: MeasureTarget): Promise<Vec3> => (typeof target === "string" ? (await kinematicsAt(scene, target, t)).position : target);
    const m = len(sub(await point(a), await point(b)));
    return { t_s: round(t, 3), distance: { m: round(m), ft: round(m * 3.28084, 1) }, a, b };
  },

  async addMarker(label, target) {
    const { scene, handle, o } = await context();
    let point: Point3;
    let entityId: string | undefined;
    if ("entity_id" in target) {
      requireVehicle(scene, target.entity_id);
      const pose = handle.vehiclePose(target.entity_id, store().time);
      if (!pose) throw new Error(`Vehicle "${target.entity_id}" isn't in the 3D scene.`);
      point = pose.position;
      entityId = target.entity_id;
    } else {
      point = toScene(target.point, o);
      const bounds = handle.bounds();
      const inside = point.every((v, i) => i === 1 || (v >= bounds.min[i] - 1e-6 && v <= bounds.max[i] + 1e-6));
      if (!inside) throw new Error("That point is outside the scene boundary.");
    }
    const marker = store().addMarker({ label, point, entityId });
    const out: AssistantMarker = { id: marker.id, label, point: toWorld(point, o), ...(entityId ? { entity_id: entityId } : {}) };
    return out;
  },

  async toggle(target: ToggleTarget, visible?: boolean) {
    const scene = openScene();
    const state = store();
    if (target === "frustums") {
      throw new Error("This reconstruction doesn't include the source camera positions, so there's nothing to show.");
    }
    if (target === "source_video") {
      if (!scene.sourceVideo) throw new Error("This reconstruction has no source video attached.");
      const next = visible ?? !state.layers.sourceVideo;
      state.setLayers({ sourceVideo: next });
      return { target, visible: next };
    }
    if (target === "trails" || target === "bounds") {
      if (target === "trails" && scene.vehicles.length === 0) throw new Error("This reconstruction has no vehicle paths to show.");
      const next = visible ?? !state.layers[target];
      state.setLayers({ [target]: next });
      return { target, visible: next };
    }
    const id = target.slice("vehicle:".length);
    requireVehicle(scene, id);
    const hidden = state.layers.hiddenVehicles.includes(id);
    const next = visible ?? hidden;
    state.setVehicleHidden(id, !next);
    return { target, visible: next };
  },

  async exportVideo(opts): Promise<ExportJob> {
    const scene = openScene();
    if (opts.camera_path) throw new Error("Named camera paths aren't available yet. I can export the current view instead.");
    const range: [number, number] = opts.range ?? [0, scene.duration];
    if (range[0] < 0 || range[1] > scene.duration || range[1] <= range[0]) {
      throw new Error(`Give a range inside the footage (0 to ${scene.duration} s), with the end after the start.`);
    }
    const job = await startExport(range);
    return { job_id: job.id, status: "rendering" };
  },
};

export type { Vec3 };
