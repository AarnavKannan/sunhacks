/**
 * Per-frame kinematics, derived from the exact trajectories playback draws (the scene's layout
 * `poseAt`, which for reconstructions is gemini/motion.ts `trackAt` over the spec keyframes) and
 * stored in MongoDB (electron/kinematics.ts). The assistant reads only these rows, so its numbers
 * are the numbers on screen.
 *
 * Everything is in the assistant's world frame: meters, +x east, +y up, -z north, origin at the
 * crash point (the midpoint of the vehicles involved at crash start). Plan frame (spec) → scene:
 * (x, y) → (x, 0, -y); world = scene − origin.
 *
 * Frame grid. Measured reconstructions sample the source video's own frames: frame f = 0..N-1
 * at t = f / fps (the demo: 12.5 fps, frames 0..399), and the stored `frame` is that video
 * frame index. Preview scenes and model readings use a synthetic 30 fps grid.
 *
 * Velocity and acceleration are central differences of position on that grid (one-sided at the
 * ends and where the object enters or leaves); net force = mass × acceleration. A jump of more
 * than TELEPORT_M between frames is leaving and re-entering the scene, never motion. Impacts are
 * not smoothed away: the change in velocity at a contact shows up as the force spike around it,
 * and the contact record (meta.contacts) carries the spec's normal and impulse next to the
 * impulse implied by the stored velocities.
 */
import type { SceneInfo, VehicleInfo } from "@/data/scenes";
import type { KinContact, KinematicsFrame, KinematicsIncident, KinSampleSource, KinStaticObject, KinVec3 } from "@/electron.d";
import { planMotion } from "@/gemini/motion";
import type { Contact, IncidentSpec, Keyframe, StaticObject } from "@/gemini/spec";
import { getLayout } from "@/scene/layouts";

/** Bumped whenever what is stored (or how it's derived) changes, so old rows are replaced. */
export const DERIVE_VERSION = "kin-v5";
/** Synthetic grid for scenes without a source frame grid (previews, model readings). */
export const FPS = 30;
const TELEPORT_M = 15;
export const PREVIEW_BASIS = "scripted preview animation, not measured from footage";

/** Nominal mass by vehicle class (kg), used for net force when nothing better is known. */
const CLASS_MASS: Record<string, number> = { hatchback: 1250, sedan: 1500, suv: 1900, van: 2200, truck: 8000, bus: 12000 };
export const massFor = (vehicle: VehicleInfo) =>
  Number.isFinite(vehicle.massKg) && vehicle.massKg! > 0 ? vehicle.massKg! : CLASS_MASS[vehicle.type] ?? 1500;

/*
 * Force breakdown. The net force (m·a) is what the motion implies; it is split into what the
 * air, the rolling tyres and the slope push with (modelled from standard coefficients), and the
 * remainder, which is what the road applies through the tyres (braking, accelerating, steering).
 * During the crash period and around each recorded contact, anything a tyre couldn't transmit
 * (more than about mu·m·g) is attributed to the impact itself.
 */
const AIR_DENSITY = 1.225; // kg/m³
/** Drag area Cd·A (m²) by class. */
const DRAG_AREA: Record<string, number> = { hatchback: 0.62, sedan: 0.65, suv: 0.9, van: 1.1, truck: 5.0, bus: 6.0 };
/** Rolling resistance coefficient by class. */
const ROLLING: Record<string, number> = { truck: 0.007, bus: 0.007 };
const G = 9.81;

/** Position / speed / acceleration uncertainty by precision tier (1 sigma). */
const TIER_SIGMA = {
  crash: { position_m: 0.5, speed_mps: 1.0, accel_mps2: 1.5 },
  background: { position_m: 2.0, speed_mps: 3.0, accel_mps2: 3.0 },
} as const;

/** Frames either side of a contact frame whose differences see the velocity jump. */
const CONTACT_FORCE_FRAMES = { before: 1, after: 2 };
/** Frames, from first contact, marked `contact_with` (the bodies touch for about this long). */
const CONTACT_MARK_FRAMES = 2;

// ---------------------------------------------------------------------------
// Source specs: reconstructions register the spec they were built from, so the stored rows can
// carry its provenance, static objects and contacts. Built-in previews have none.

const sources = new Map<string, IncidentSpec>();

/** Remembers the spec a reconstruction scene was built from (call it whenever the scene is (re)built). */
export function registerSceneSpec(sceneId: string, spec: IncidentSpec) {
  sources.set(sceneId, spec);
}

export function sceneSpec(sceneId: string): IncidentSpec | undefined {
  return sources.get(sceneId);
}

/** Measured reconstruction (calibrated per-frame tracks) rather than a model's reading. */
export function isMeasuredSpec(spec: IncidentSpec) {
  return /measured/i.test(spec.prompt_version ?? "") || spec.objects.some((o) => o.keyframes?.some((k) => k.src !== undefined));
}

/**
 * The source video's frame rate when the spec is sampled on its frames, else null. From the
 * contacts' (frame, t_s) when given, otherwise from keyframe times that sit on a common frame grid.
 */
export function sourceFps(spec: IncidentSpec): number | null {
  if (!isMeasuredSpec(spec)) return null;
  // The A9 source clock is known independently of the event annotations (400 frames / 32 s).
  if (/measured.*a9|a9.*measured/i.test(spec.prompt_version)) return 12.5;
  const fromContacts = (spec.crash?.contacts ?? [])
    .filter((c) => Number.isInteger(c.frame) && (c.frame ?? 0) > 0 && c.t_s > 0)
    .map((c) => c.frame! / c.t_s);
  if (fromContacts.length && fromContacts.every((f) => Math.abs(f - fromContacts[0]) / fromContacts[0] < 0.01)) {
    return Math.round(fromContacts[0] * 1000) / 1000;
  }
  const times = spec.objects.flatMap((o) => (o.keyframes ?? []).map((k) => k.t_s)).filter(Number.isFinite);
  if (times.length < 20) return null;
  for (const fps of [12.5, 25, 30, 24, 15, 10, 29.97, 50, 60]) {
    const on = times.filter((t) => Math.abs(t * fps - Math.round(t * fps)) < 0.02).length;
    if (on / times.length >= 0.98) return fps;
  }
  return null;
}

// ---------------------------------------------------------------------------

/** The crash point in scene (three.js) coordinates; [0, 0, 0] when there's no crash. */
export function crashOrigin(scene: SceneInfo): KinVec3 {
  const layout = getLayout(scene.id);
  if (!layout || scene.impactTime == null || scene.crashVehicles.length === 0) return [0, 0, 0];
  const poses = scene.crashVehicles
    .map((id) => layout.vehicles.find((item) => item.id === id)?.poseAt(scene.impactTime!))
    .filter((pose) => pose !== undefined);
  if (!poses.length) return [0, 0, 0];
  return [poses.reduce((s, p) => s + p.x, 0) / poses.length, 0, poses.reduce((s, p) => s + p.z, 0) / poses.length];
}

const sub = (a: KinVec3, b: KinVec3): KinVec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: KinVec3, k: number): KinVec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: KinVec3) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: KinVec3, b: KinVec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const r3 = (v: KinVec3): KinVec3 => [round(v[0]), round(v[1]), round(v[2])];
const ZERO: KinVec3 = [0, 0, 0];
/** Compass bearing of a world-frame direction: 0 = north (-z), 90 = east (+x). */
const bearing = (v: KinVec3) => ((Math.atan2(v[0], -v[2]) * 180) / Math.PI + 360) % 360;
/** Compass bearing a body faces, from a layout pose yaw. */
const yawBearing = (yaw: number) => (((180 - (yaw * 180) / Math.PI) % 360) + 360) % 360;
const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
/** Plan-frame point (x along the road, y to its left) → world frame. */
const planPoint = (x: number, y: number, origin: KinVec3): KinVec3 => [x - origin[0], 0, -y - origin[2]];
/** Plan-frame direction (degrees) → world unit vector. */
const planDir = (deg: number): KinVec3 => {
  const h = (deg * Math.PI) / 180;
  return [Math.cos(h), 0, -Math.sin(h)];
};

/** Central difference with one-sided fallback where the motion isn't continuous and at the ends. */
function derivative(values: KinVec3[], continuous: (i: number, j: number) => boolean, dt: number): KinVec3[] {
  return values.map((value, i) => {
    const prev = i > 0 && continuous(i - 1, i) ? values[i - 1] : null;
    const next = i < values.length - 1 && continuous(i, i + 1) ? values[i + 1] : null;
    if (prev && next) return scale(sub(next, prev), 1 / (2 * dt));
    if (next) return scale(sub(next, value), 1 / dt);
    if (prev) return scale(sub(value, prev), 1 / dt);
    return [0, 0, 0];
  });
}

/** Provenance and position sigma at time t from time-ordered keyframes (the ones playback uses). */
function provenance(frames: Keyframe[], t: number, tol: number, measured: boolean): { src?: KinSampleSource; sigma?: number } {
  if (!frames.length) return {};
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t_s <= t) lo = mid;
    else hi = mid;
  }
  const near = [frames[lo], frames[hi]].find((k) => Math.abs(k.t_s - t) <= tol);
  const src = (k: Keyframe): KinSampleSource | undefined => k.src ?? (measured ? "measured" : undefined);
  if (near) return { src: src(near), sigma: near.sigma_m };
  const a = frames[lo];
  const b = frames[hi];
  const sa = src(a);
  const sb = src(b);
  // A hold or run-in between two samples of the same kind is that kind, not an observation gap.
  const heldRest = sb === "occluded-rest" && Math.hypot(b.x_m - a.x_m, b.y_m - a.y_m) < 1e-9;
  const kind = heldRest ? "occluded-rest" : sa && sa === sb && sa !== "measured" ? sa : measured ? "interpolated" : undefined;
  const u = b.t_s > a.t_s ? Math.min(1, Math.max(0, (t - a.t_s) / (b.t_s - a.t_s))) : 0;
  const sigma = a.sigma_m !== undefined && b.sigma_m !== undefined ? a.sigma_m + (b.sigma_m - a.sigma_m) * u : (a.sigma_m ?? b.sigma_m);
  return { src: kind, sigma };
}

/** World-frame geometry of a fixed object. */
function staticGeometry(object: StaticObject, origin: KinVec3): KinStaticObject {
  const pts = object.footprint_m.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  // Polygon area centroid (falls back to the vertex mean for degenerate outlines).
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  let centre: [number, number];
  if (Math.abs(area) > 1e-9) centre = [cx / (3 * area), cy / (3 * area)];
  else centre = [pts.reduce((s, p) => s + p[0], 0) / (pts.length || 1), pts.reduce((s, p) => s + p[1], 0) / (pts.length || 1)];
  // Long axis: principal direction of the outline.
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - centre[0]) ** 2;
    syy += (y - centre[1]) ** 2;
    sxy += (x - centre[0]) * (y - centre[1]);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const along: [number, number] = [Math.cos(angle), Math.sin(angle)];
  const across: [number, number] = [-along[1], along[0]];
  const extent = (d: [number, number]) => {
    const proj = pts.map(([x, y]) => (x - centre[0]) * d[0] + (y - centre[1]) * d[1]);
    return proj.length ? Math.max(...proj) - Math.min(...proj) : 0;
  };
  return {
    id: object.id,
    label: object.label,
    kind: object.kind,
    material: object.material,
    footprint: pts.map(([x, y]) => r3(planPoint(x, y, origin))),
    centroid: r3(planPoint(centre[0], centre[1], origin)),
    axis: r3([along[0], 0, -along[1]]),
    length_m: round(extent(along), 3),
    width_m: round(extent(across), 3),
    height_m: object.height_m,
    friction: object.friction,
    restitution: object.restitution,
    stiffness_n_per_m: object.stiffness_n_per_m,
    immovable: true,
    source: object.source,
    sigma_m: object.sigma_m,
    note: object.note,
  };
}

type Grid = { fps: number; count: number; source: "video" | "preview" };

function gridFor(scene: SceneInfo, spec: IncidentSpec | undefined): Grid {
  const fps = spec ? sourceFps(spec) : null;
  if (fps) return { fps, count: Math.max(1, Math.floor(scene.duration * fps + 1e-6)), source: "video" };
  return { fps: FPS, count: Math.floor(scene.duration * FPS + 1e-6) + 1, source: "preview" };
}

export function deriveSceneKinematics(scene: SceneInfo): { meta: KinematicsIncident; frames: KinematicsFrame[] } | null {
  const layout = getLayout(scene.id);
  if (scene.kind !== "proxy" || !layout || scene.vehicles.length === 0) return null;
  const spec = sources.get(scene.id);
  const measured = spec ? isMeasuredSpec(spec) : false;
  const origin = crashOrigin(scene);
  const grid = gridFor(scene, spec);
  const dt = 1 / grid.fps;
  const count = grid.count;
  const times = Array.from({ length: count }, (_, i) => Math.min(scene.duration, i / grid.fps));
  const frames: KinematicsFrame[] = [];
  const entities: KinematicsIncident["entities"] = [];

  // The keyframes playback replays (cleaned and with any occluded-rest hold), for provenance.
  const keyframes = new Map<string, Keyframe[]>();
  if (spec) {
    const plan = planMotion(structuredClone(spec), { seed: 0, friction: { mu: 0.7, range: [0.6, 0.8] } });
    for (const v of plan.vehicles) keyframes.set(v.object.id, v.object.keyframes);
  }

  const statics = (spec?.static_objects ?? []).filter((o) => o?.id && Array.isArray(o.footprint_m) && o.footprint_m.length >= 2);
  const staticIds = new Set(statics.map((o) => o.id));
  const contactsIn = spec?.crash?.contacts ?? [];
  const contactFrame = (c: Contact) =>
    grid.source === "video" ? (Number.isInteger(c.frame) ? c.frame! : Math.round(c.t_s * grid.fps)) : Math.round(c.t_s * grid.fps);
  /** Frame index → ids each entity touches there. */
  const touching = new Map<string, Map<number, Set<string>>>();
  const mark = (id: string, frame: number, other: string) => {
    const byFrame = touching.get(id) ?? new Map<number, Set<string>>();
    const set = byFrame.get(frame) ?? new Set<string>();
    set.add(other);
    byFrame.set(frame, set);
    touching.set(id, byFrame);
  };
  /** Per vehicle, frames whose force can include the impact. */
  const impactFrames = new Map<string, Set<number>>();
  for (const c of contactsIn) {
    const f = contactFrame(c);
    for (let k = 0; k < CONTACT_MARK_FRAMES; k++) {
      mark(c.a, f + k, c.b);
      mark(c.b, f + k, c.a);
    }
    for (const id of [c.a, c.b]) {
      const set = impactFrames.get(id) ?? new Set<number>();
      for (let k = -CONTACT_FORCE_FRAMES.before; k <= CONTACT_FORCE_FRAMES.after; k++) set.add(f + k);
      impactFrames.set(id, set);
    }
  }
  const contactWith = (id: string, i: number) => {
    const set = touching.get(id)?.get(i);
    return set ? [...set].sort() : undefined;
  };

  const physics = scene.physics ?? { wind: [0, 0, 0] as KinVec3, gradePercent: 0, surface: "dry", mu: 0.75 };
  const crashSet = new Set(scene.crashVehicles);
  const inCrash = (t: number) => scene.impactTime != null && t >= scene.impactTime - 0.05 && t <= (scene.crashEnd ?? scene.impactTime) + 0.05;
  // Gravity along the slope; the grade is taken as rising toward +x (along the main road).
  const theta = Math.atan(physics.gradePercent / 100);
  /** Per vehicle, stored velocity by frame, for the contacts' implied impulses. */
  const velocities = new Map<string, { mass: number; v: (KinVec3 | null)[] }>();

  const seen = new Set<string>();
  for (const vehicle of scene.vehicles) {
    if (seen.has(vehicle.id) || staticIds.has(vehicle.id)) {
      console.warn(`Kinematics: skipped a second object with id "${vehicle.id}" in ${scene.id}; ids must be unique.`);
      continue;
    }
    seen.add(vehicle.id);
    const motion = layout.vehicles.find((item) => item.id === vehicle.id);
    if (!motion) continue;
    const mass = massFor(vehicle);
    const involvement = vehicle.involvement ?? (crashSet.has(vehicle.id) ? "crash" : "background");
    // Position sigma comes from the measured fit. Its time correlation is unknown, so a
    // small generic speed/acceleration sigma would claim precision the camera cannot supply.
    const tier = !measured && scene.basis ? TIER_SIGMA[involvement] : null;
    const dragArea = DRAG_AREA[vehicle.type] ?? 0.7;
    const crr = ROLLING[vehicle.type] ?? 0.012;
    const reported = scene.reportedForces?.[vehicle.id] ?? [];
    const grade: KinVec3 = [-mass * G * Math.sin(theta), 0, 0];
    const keys = keyframes.get(vehicle.id) ?? [];
    const impacts = impactFrames.get(vehicle.id);
    // Exactly what the viewer draws at each frame time.
    const poses = times.map((t) => motion.poseAt(t));
    for (let i = 0; i < poses.length; i++) {
      const pose = poses[i];
      if (!pose.hidden && ![pose.x, pose.z, pose.yaw].every(Number.isFinite)) {
        throw new Error(`Non-finite playback pose for ${vehicle.id} at frame ${i} (${times[i]} s).`);
      }
    }
    const positions = poses.map((pose): KinVec3 => sub([pose.x, 0, pose.z], origin));
    // A vehicle off the road (before it enters / after it leaves) is not stored; entering or leaving
    // is not motion, so differences never cross that edge (no fake speed or force spike there).
    const continuous = (i: number, j: number) => !poses[i].hidden && !poses[j].hidden && len(sub(positions[j], positions[i])) <= TELEPORT_M;
    const velocity = derivative(positions, continuous, dt);
    const accel = derivative(velocity, continuous, dt);
    const facing = poses.map((pose) => yawBearing(pose.yaw));
    velocities.set(vehicle.id, { mass, v: velocity.map((v, i) => (poses[i].hidden ? null : v)) });

    for (let i = 0; i < count; i++) {
      // Not stored while it's off the road; the database then answers "not in the scene" there.
      if (poses[i].hidden) continue;
      const v = velocity[i];
      const a = accel[i];
      const speed = len(v);
      // Below walking pace the direction of travel is noise; use the body's facing instead.
      const heading = speed > 0.3 ? bearing(v) : facing[i];
      const forward: KinVec3 = speed > 0.05 ? scale(v, 1 / speed) : planDir(90 - facing[i]);
      const prevOk = i > 0 && continuous(i - 1, i);
      const nextOk = i < count - 1 && continuous(i, i + 1);
      const span = (prevOk ? dt : 0) + (nextOk ? dt : 0);
      const yawRate = span > 0 ? wrap180(facing[nextOk ? i + 1 : i] - facing[prevOk ? i - 1 : i]) / span : 0;
      const net = scale(a, mass);
      const air = sub(v, physics.wind);
      const drag = scale(air, -0.5 * AIR_DENSITY * dragArea * len(air));
      const rolling: KinVec3 = speed > 0.1 ? scale(v, (-crr * mass * G * Math.cos(theta)) / speed) : [0, 0, 0];
      let tyre = sub(sub(sub(net, drag), rolling), grade);
      let contact: KinVec3 = [0, 0, 0];
      const grip = physics.mu * 1.1 * mass * G;
      const impactHere = impacts?.has(i) || (crashSet.has(vehicle.id) && inCrash(times[i]));
      if (impactHere && len(tyre) > grip) {
        const kept = scale(tyre, grip / len(tyre));
        contact = sub(tyre, kept);
        tyre = kept;
      }
      const prov = spec ? provenance(keys, times[i], 0.25 * dt, measured) : {};
      const sigma = prov.sigma !== undefined ? { ...(tier ?? {}), position_m: round(prov.sigma, 3) } : tier ? { ...tier } : null;
      const touches = contactWith(vehicle.id, i);
      frames.push({
        incident_id: scene.id,
        entity_id: vehicle.id,
        t: round(times[i], 6),
        frame: i,
        position: r3(positions[i]),
        velocity: r3(v),
        speed: round(speed),
        accel: r3(a),
        accel_long: round(dot(a, forward)),
        heading_deg: round(heading, 2),
        body_heading_deg: round(facing[i], 2),
        yaw_rate_dps: round(yawRate, 3),
        mass_kg: mass,
        force_net: r3(net),
        force_parts: { tyre_road: r3(tyre), drag: r3(drag), rolling: r3(rolling), grade: r3(grade), contact: r3(contact) },
        force_reported: reportedAt(reported, times[i]),
        involvement,
        sigma,
        entity_kind: "vehicle",
        ...(prov.src ? { src: prov.src } : {}),
        ...(touches ? { contact_with: touches } : {}),
      });
    }
    const shown = times.filter((_, i) => !poses[i].hidden);
    const from_s = vehicle.visibleFrom ?? (shown.length ? shown[0] : 0);
    const to_s = vehicle.visibleTo ?? (shown.length ? shown[shown.length - 1] : scene.duration);
    entities.push({ id: vehicle.id, label: vehicle.label, type: vehicle.type, mass_kg: mass, from_s, to_s, involvement, kind: "vehicle" });
  }

  // Fixed objects: one row per frame, never moving. Immovable means the ground takes any contact
  // reaction, so their net force is zero; stored mass 0 stands for "not a free body".
  const staticObjects = statics.map((object) => staticGeometry(object, origin));
  const contactParticipants = new Set(contactsIn.flatMap((c) => [c.a, c.b]));
  for (const object of staticObjects) {
    const involvement = contactParticipants.has(object.id) ? "crash" : "background";
    const facingDeg = round(bearing(object.axis), 2);
    for (let i = 0; i < count; i++) {
      const touches = contactWith(object.id, i);
      frames.push({
        incident_id: scene.id,
        entity_id: object.id,
        t: round(times[i], 6),
        frame: i,
        position: object.centroid,
        velocity: ZERO,
        speed: 0,
        accel: ZERO,
        accel_long: 0,
        heading_deg: facingDeg,
        body_heading_deg: facingDeg,
        yaw_rate_dps: 0,
        mass_kg: 0,
        force_net: ZERO,
        force_parts: { tyre_road: ZERO, drag: ZERO, rolling: ZERO, grade: ZERO, contact: ZERO },
        force_reported: null,
        involvement,
        sigma: { position_m: object.sigma_m, speed_mps: 0, accel_mps2: 0 },
        entity_kind: "static",
        src: "static",
        ...(touches ? { contact_with: touches } : {}),
      });
    }
    entities.push({ id: object.id, label: object.label, type: object.kind, mass_kg: 0, from_s: 0, to_s: times[count - 1], involvement, kind: "static" });
  }

  const contacts: KinContact[] = contactsIn.map((c) => {
    const frame = contactFrame(c);
    const normal = planDir(c.normal_deg);
    const impulseNs = Number.isFinite(c.impulse_ns) ? c.impulse_ns! : null;
    const kind = c.kind ?? (staticIds.has(c.a) || staticIds.has(c.b) ? "vehicle-static" : "vehicle-vehicle");
    // Velocity just before (frame-1, whose difference ends at the contact frame) and just after
    // (frame+2, past the frames the impact is spread over) from the stored rows.
    const before = frame - 1;
    const after = frame + CONTACT_FORCE_FRAMES.after;
    const derived: KinContact["derived"] = [];
    for (const [id, sign] of [
      [c.a, -1],
      [c.b, 1],
    ] as const) {
      const track = velocities.get(id);
      const v0 = track?.v[before];
      const v1 = track?.v[after];
      if (!track || !v0 || !v1) continue;
      const dv = sub(v1, v0);
      const impulse = scale(dv, track.mass);
      derived.push({
        entity_id: id,
        mass_kg: track.mass,
        delta_v: r3(dv),
        impulse: r3(impulse),
        // Signed along the push this body receives: +normal for b, −normal for a.
        along_normal_ns: round(sign * dot(impulse, normal), 1),
        window_s: round((after - before) * dt, 4),
      });
    }
    return {
      a: c.a,
      b: c.b,
      kind,
      frame: grid.source === "video" ? frame : Number.isInteger(c.frame) ? c.frame! : null,
      t: round(c.t_s, 6),
      point: r3(planPoint(c.x_m, c.y_m, origin)),
      normal: r3(normal),
      normal_deg_plan: c.normal_deg,
      impulse_ns: impulseNs,
      impulse: impulseNs === null ? null : r3(scale(normal, impulseNs)),
      derived,
      source: c.source ?? (measured ? "measured" : "inferred"),
      ...(c.sigma_s !== undefined ? { sigma_s: c.sigma_s } : {}),
      ...(c.note ? { note: c.note } : {}),
    };
  });

  const specVersion = spec ? `${spec.prompt_version}#${hashOf(JSON.stringify(spec))}` : `preview:${scene.id}`;
  const basis =
    spec && measured
      ? `measured per source video frame (${grid.fps} fps) from calibrated camera tracks; samples labelled interpolated, edge-/out-of-view-extrapolated or occluded-rest are not direct observations; velocity, acceleration and force are central differences of the played-back positions (net force = mass × acceleration); their uncertainty is not quantified by the position sigma; force decomposition uses assumed coefficients, not separately observed tyre/contact forces`
      : (scene.basis ?? PREVIEW_BASIS);
  const meta: KinematicsIncident = {
    _id: scene.id,
    title: scene.title,
    hash: "",
    fps: grid.fps,
    duration_s: scene.duration,
    origin_scene: origin,
    crash: scene.impactTime == null ? null : { start_s: scene.impactTime, end_s: scene.crashEnd ?? scene.impactTime, vehicles: scene.crashVehicles },
    entities,
    basis,
    ...(spec?.caveats?.length ? { caveats: [...spec.caveats] } : {}),
    physics: { ...physics, air_density: AIR_DENSITY },
    version: `${DERIVE_VERSION}|${specVersion}`,
    frame_grid: { fps: grid.fps, first_frame: 0, last_frame: count - 1, source: grid.source },
    ...(staticObjects.length ? { static_objects: staticObjects } : {}),
    ...(contacts.length ? { contacts } : {}),
  };
  meta.hash = hashOf(JSON.stringify([meta, frames]));
  return { meta, frames };
}

/** Gemini's own force reading nearest this time (within a quarter second), if any. */
function reportedAt(samples: NonNullable<SceneInfo["reportedForces"]>[string], t: number): KinematicsFrame["force_reported"] {
  let best: (typeof samples)[number] | null = null;
  for (const sample of samples) if (Math.abs(sample.t - t) <= 0.25 && (!best || Math.abs(sample.t - t) < Math.abs(best.t - t))) best = sample;
  return best ? { vector: r3(best.force), cause: best.cause, note: best.note } : null;
}

/** Two independent FNV-1a passes (64 bits) + length: enough to notice that the stored frames are stale. */
export function hashOf(text: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h2 >>> 15);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0") + `-${text.length}`;
}
