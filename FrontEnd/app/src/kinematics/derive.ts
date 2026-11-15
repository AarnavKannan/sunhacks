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

/** Nominal mass by vehicle class (kg), used for net force until the pipeline estimates mass. */
const CLASS_MASS: Record<string, number> = { hatchback: 1250, sedan: 1500, suv: 1900, van: 2200, truck: 8000 };
export const massFor = (vehicle: VehicleInfo) => CLASS_MASS[vehicle.type] ?? 1500;

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

  for (const vehicle of scene.vehicles) {
    const motion = layout.vehicles.find((item) => item.id === vehicle.id);
    if (!motion) continue;
    const mass = massFor(vehicle);
    const times = Array.from({ length: count }, (_, i) => Math.min(scene.duration, i * dt));
    const poses = times.map((t) => motion.poseAt(t));
    const positions = poses.map((pose): KinVec3 => sub([pose.x, 0, pose.z], origin));
    const continuous = (i: number, j: number) => len(sub(positions[j], positions[i])) <= TELEPORT_M;
    const velocity = derivative(positions, continuous, dt);
    const accel = derivative(velocity, continuous, dt);
    const headings = poses.map((pose, i) => {
      const v = velocity[i];
      // Below walking pace the direction of travel is noise; use the body's facing instead.
      if (len(v) > 0.3) return bearing(v);
      return (((180 - (pose.yaw * 180) / Math.PI) % 360) + 360) % 360;
    });

    for (let i = 0; i < count; i++) {
      const v = velocity[i];
      const a = accel[i];
      const speed = len(v);
      const forward: KinVec3 = speed > 0.05 ? scale(v, 1 / speed) : [Math.sin(poses[i].yaw), 0, Math.cos(poses[i].yaw)];
      const prev = i > 0 && continuous(i - 1, i) ? headings[i - 1] : headings[i];
      const next = i < count - 1 && continuous(i, i + 1) ? headings[i + 1] : headings[i];
      const span = (i > 0 && continuous(i - 1, i) ? dt : 0) + (i < count - 1 && continuous(i, i + 1) ? dt : 0);
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
        force_net: r3(scale(a, mass)),
        sigma: null,
      });
    }
    entities.push({ id: vehicle.id, label: vehicle.label, type: vehicle.type, mass_kg: mass, from_s: 0, to_s: scene.duration });
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
    basis: PREVIEW_BASIS,
  };
  meta.hash = hashOf(JSON.stringify([meta, frames]));
  return { meta, frames };
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
