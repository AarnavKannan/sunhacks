/**
 * Per-frame kinematics for the built-in preview scenes, derived from their scripted
 * trajectories (scene/layouts.ts) and stored in MongoDB like real tracking output would be.
 *
 * Everything is in the assistant's world frame: meters, +x east, +y up, -z north, origin at
 * the crash point (the midpoint of the vehicles involved at crash start).
 *
 * Velocity and acceleration are central differences of position at FPS; a jump of more than
 * TELEPORT_M between frames (a looped road sending a car back to the start) is treated as
 * leaving and re-entering the scene, never as motion.
 */
import type { SceneInfo, VehicleInfo } from "@/data/scenes";
import type { KinematicsFrame, KinematicsIncident, KinVec3 } from "@/electron.d";
import { getLayout } from "@/scene/layouts";

export const FPS = 30;
const TELEPORT_M = 15;
export const PREVIEW_BASIS = "scripted preview animation, not measured from footage";

/** Nominal mass by vehicle class (kg), used for net force when nothing better is known. */
const CLASS_MASS: Record<string, number> = { hatchback: 1250, sedan: 1500, suv: 1900, van: 2200, truck: 8000, bus: 12000 };
export const massFor = (vehicle: VehicleInfo) => vehicle.massKg ?? CLASS_MASS[vehicle.type] ?? 1500;

/*
 * Force breakdown. The net force (m·a) is what the motion implies; it is split into what the
 * air, the rolling tyres and the slope push with (modelled from standard coefficients), and the
 * remainder, which is what the road applies through the tyres (braking, accelerating, steering).
 * During the crash period, anything a tyre couldn't transmit (more than about mu·m·g) is
 * attributed to the impact itself.
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
const bearing = (v: KinVec3) => ((Math.atan2(v[0], -v[2]) * 180) / Math.PI + 360) % 360;
const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Central difference with one-sided fallback across teleports and at the ends. */
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

export function deriveSceneKinematics(scene: SceneInfo): { meta: KinematicsIncident; frames: KinematicsFrame[] } | null {
  const layout = getLayout(scene.id);
  if (scene.kind !== "proxy" || !layout || scene.vehicles.length === 0) return null;
  const origin = crashOrigin(scene);
  const dt = 1 / FPS;
  const count = Math.floor(scene.duration * FPS + 1e-6) + 1;
  const frames: KinematicsFrame[] = [];
  const entities: KinematicsIncident["entities"] = [];

  const physics = scene.physics ?? { wind: [0, 0, 0] as KinVec3, gradePercent: 0, surface: "dry", mu: 0.75 };
  const crashSet = new Set(scene.crashVehicles);
  const inCrash = (t: number) => scene.impactTime != null && t >= scene.impactTime - 0.05 && t <= (scene.crashEnd ?? scene.impactTime) + 0.05;
  // Gravity along the slope; the grade is taken as rising toward +x (along the main road).
  const theta = Math.atan(physics.gradePercent / 100);

  for (const vehicle of scene.vehicles) {
    const motion = layout.vehicles.find((item) => item.id === vehicle.id);
    if (!motion) continue;
    const mass = massFor(vehicle);
    const involvement = vehicle.involvement ?? (crashSet.has(vehicle.id) ? "crash" : "background");
    const sigma = scene.basis ? TIER_SIGMA[involvement] : null;
    const dragArea = DRAG_AREA[vehicle.type] ?? 0.7;
    const crr = ROLLING[vehicle.type] ?? 0.012;
    const reported = scene.reportedForces?.[vehicle.id] ?? [];
    const grade: KinVec3 = [-mass * G * Math.sin(theta), 0, 0];
    const times = Array.from({ length: count }, (_, i) => Math.min(scene.duration, i * dt));
    const poses = times.map((t) => motion.poseAt(t));
    const positions = poses.map((pose): KinVec3 => sub([pose.x, 0, pose.z], origin));
    // A vehicle off the road (before it enters / after it leaves) is held still; entering or leaving
    // is not motion, so differences never cross that edge (no fake speed or force spike there).
    const continuous = (i: number, j: number) => !poses[i].hidden && !poses[j].hidden && len(sub(positions[j], positions[i])) <= TELEPORT_M;
    const velocity = derivative(positions, continuous, dt);
    const accel = derivative(velocity, continuous, dt);
    const headings = poses.map((pose, i) => {
      const v = velocity[i];
      // Below walking pace the direction of travel is noise; use the body's facing instead.
      if (len(v) > 0.3) return bearing(v);
      return (((180 - (pose.yaw * 180) / Math.PI) % 360) + 360) % 360;
    });

    for (let i = 0; i < count; i++) {
      // Not stored while it's off the road; the database then answers "not in the scene" there.
      if (poses[i].hidden) continue;
      const v = velocity[i];
      const a = accel[i];
      const speed = len(v);
      const forward: KinVec3 = speed > 0.05 ? scale(v, 1 / speed) : [Math.sin(poses[i].yaw), 0, Math.cos(poses[i].yaw)];
      const prev = i > 0 && continuous(i - 1, i) ? headings[i - 1] : headings[i];
      const next = i < count - 1 && continuous(i, i + 1) ? headings[i + 1] : headings[i];
      const span = (i > 0 && continuous(i - 1, i) ? dt : 0) + (i < count - 1 && continuous(i, i + 1) ? dt : 0);
      const net = scale(a, mass);
      const air = sub(v, physics.wind);
      const drag = scale(air, -0.5 * AIR_DENSITY * dragArea * len(air));
      const rolling: KinVec3 = speed > 0.1 ? scale(v, (-crr * mass * G * Math.cos(theta)) / speed) : [0, 0, 0];
      let tyre = sub(sub(sub(net, drag), rolling), grade);
      let contact: KinVec3 = [0, 0, 0];
      const grip = physics.mu * 1.1 * mass * G;
      if (crashSet.has(vehicle.id) && inCrash(times[i]) && len(tyre) > grip) {
        const kept = scale(tyre, grip / len(tyre));
        contact = sub(tyre, kept);
        tyre = kept;
      }
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
        heading_deg: round(headings[i], 2),
        yaw_rate_dps: span > 0 ? round(wrap180(next - prev) / span, 3) : 0,
        mass_kg: mass,
        force_net: r3(net),
        force_parts: { tyre_road: r3(tyre), drag: r3(drag), rolling: r3(rolling), grade: r3(grade), contact: r3(contact) },
        force_reported: reportedAt(reported, times[i]),
        involvement,
        sigma: sigma ? { ...sigma } : null,
      });
    }
    const shown = times.filter((_, i) => !poses[i].hidden);
    const from_s = shown.length ? shown[0] : 0;
    const to_s = shown.length ? shown[shown.length - 1] : scene.duration;
    entities.push({ id: vehicle.id, label: vehicle.label, type: vehicle.type, mass_kg: mass, from_s, to_s, involvement });
  }

  const meta: KinematicsIncident = {
    _id: scene.id,
    title: scene.title,
    hash: "",
    fps: FPS,
    duration_s: scene.duration,
    origin_scene: origin,
    crash: scene.impactTime == null ? null : { start_s: scene.impactTime, end_s: scene.crashEnd ?? scene.impactTime, vehicles: scene.crashVehicles },
    entities,
    basis: scene.basis ?? PREVIEW_BASIS,
    physics: { ...physics, air_density: AIR_DENSITY },
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

/** FNV-1a, enough to notice that a trajectory changed and the stored frames are stale. */
function hashOf(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + `-${text.length}`;
}
