/**
 * The motion half of the engine: turns Gemini's reading of the footage (spec.ts) into a
 * trajectory for every vehicle, in the plan frame, sampled at SIM_HZ.
 *
 * Two precision tiers:
 *
 *   Crash vehicles (high precision, deterministic). Between Gemini's keyframes the motion comes
 *   from Gemini's own force vectors (a = F / m), corrected with a Hermite term so the path still
 *   passes through every observed position and velocity. At each contact the bodies are snapped
 *   so they visibly touch (blended in over the second before, never a jump), the impulse is
 *   solved from momentum and restitution, and the vehicles slide to rest under road friction,
 *   with the friction fitted to where Gemini saw them stop.
 *
 *   Background vehicles (approximate, seeded). They drive along their lane (or Gemini's path
 *   where there is no lane to snap to) under a car-following model (IDM), with small seeded
 *   variations in lane offset, speed and timing, so two builds can differ slightly. A guard then
 *   checks every frame: a background vehicle must never touch the crash vehicles (or come
 *   within GUARD_CRASH_M of them) or another vehicle. Where it would, it is held back behind
 *   the conflict, like traffic stopping for a wreck; if that can't work, it is removed. That is
 *   what keeps uninvolved traffic looking uninvolved.
 *
 * Pure TypeScript with no app imports, so it can be tested on its own.
 */
import type { IncidentSpec, Keyframe, SpecObject } from "./spec";
import {
  add,
  bodyGap,
  contactNormal,
  dirOf,
  dot,
  len,
  mul,
  muForDistance,
  reach,
  resolveCollision,
  slide,
  smoothstep,
  sub,
  unit,
  wrapDeg,
  type Body,
  type V2,
} from "./physics";

/** 50 Hz: a multiple of the demo footage's 12.5 fps, so every measured frame lands exactly on a sample. */
export const SIM_HZ = 50;
const DT = 1 / SIM_HZ;
/** Coefficient of restitution for car-to-car impacts (same as the pipeline's collision model). */
export const RESTITUTION = 0.15;
/** Background traffic keeps at least this much clear space around crash vehicles (m). */
export const GUARD_CRASH_M = 1.0;
/** ...and around each other (m). */
const GUARD_TRAFFIC_M = 0.25;
/** How far paths run past the footage so vehicles drive in and out instead of popping (m). */
const RUNOUT_M = 400;
/** Each round re-simulates all traffic once and fixes every conflict it found. */
export const MAX_HOLD_ROUNDS = 20;

export type Track = { x: Float64Array; y: Float64Array; h: Float64Array };

export type PlannedVehicle = {
  object: SpecObject;
  track: Track;
  /** What the engine changed to keep the scene physically and visually sane. */
  adjustments: string[];
};

export type Friction = { mu: number; range: [number, number] };

export type LaneModel = {
  /** Plan-y of each lane centre for traffic moving +x, and for traffic moving -x. */
  forward: number[];
  backward: number[];
};

export type PlanOptions = {
  seed: number;
  friction: Friction;
  /** Lane centres of the main road, when it runs straight along x (straight roads and highways). */
  lanes?: LaneModel;
};

export type MotionPlan = {
  duration: number;
  samples: number;
  vehicles: PlannedVehicle[];
  crash: { start_s: number; end_s: number; participants: string[] } | null;
  /** Objects not placed in the scene, with the reason. */
  removed: { id: string; label: string; reason: string }[];
  notes: string[];
};

// ---------------------------------------------------------------------------
// Tracks

function newTrack(n: number): Track {
  return { x: new Float64Array(n), y: new Float64Array(n), h: new Float64Array(n) };
}

const indexOf = (t: number, n: number) => Math.min(n - 1, Math.max(0, Math.round(t * SIM_HZ)));

export function trackAt(track: Track, t: number): { p: V2; h: number } {
  const n = track.x.length;
  const f = Math.min(n - 1, Math.max(0, t * SIM_HZ));
  const i = Math.min(n - 2, Math.floor(f));
  if (n < 2) return { p: [track.x[0], track.y[0]], h: track.h[0] };
  const k = f - i;
  const dh = wrapDeg(track.h[i + 1] - track.h[i]);
  return { p: [track.x[i] + (track.x[i + 1] - track.x[i]) * k, track.y[i] + (track.y[i + 1] - track.y[i]) * k], h: track.h[i] + dh * k };
}

/** Velocity just before time t (backward difference), so a contact at t isn't polluted by what follows. */
function velocityBefore(track: Track, t: number, span = 0.1): V2 {
  const a = trackAt(track, Math.max(0, t - span)).p;
  const b = trackAt(track, t).p;
  const dt = Math.min(span, t) || span;
  return mul(sub(b, a), 1 / dt);
}

const bodyOf = (object: SpecObject, track: Track, i: number): Body => ({
  p: [track.x[i], track.y[i]],
  headingDeg: track.h[i],
  length: object.length_m,
  width: object.width_m,
});

// ---------------------------------------------------------------------------
// Crash vehicles: force-driven Hermite through Gemini's keyframes

function forceAt(object: SpecObject, t: number): V2 {
  const f = object.forces;
  if (f.length === 0 || t < f[0].t_s - 0.25 || t > f.at(-1)!.t_s + 0.25) return [0, 0];
  if (t <= f[0].t_s) return [f[0].fx_n, f[0].fy_n];
  for (let i = 0; i < f.length - 1; i++) {
    if (t <= f[i + 1].t_s) {
      const k = (t - f[i].t_s) / Math.max(1e-6, f[i + 1].t_s - f[i].t_s);
      return [f[i].fx_n + (f[i + 1].fx_n - f[i].fx_n) * k, f[i].fy_n + (f[i + 1].fy_n - f[i].fy_n) * k];
    }
  }
  return [f.at(-1)!.fx_n, f.at(-1)!.fy_n];
}

/** Velocity to pass through each keyframe with: Gemini's reading blended with what the positions imply. */
function keyVelocities(k: Keyframe[]): V2[] {
  return k.map((frame, i) => {
    const prev = k[i - 1];
    const next = k[i + 1];
    let fd: V2 | null = null;
    if (prev && next) fd = mul(sub([next.x_m, next.y_m], [prev.x_m, prev.y_m]), 1 / (next.t_s - prev.t_s));
    else if (next) fd = mul(sub([next.x_m, next.y_m], [frame.x_m, frame.y_m]), 1 / (next.t_s - frame.t_s));
    else if (prev) fd = mul(sub([frame.x_m, frame.y_m], [prev.x_m, prev.y_m]), 1 / (frame.t_s - prev.t_s));
    const seen = mul(dirOf(frame.heading_deg), frame.speed_mps);
    if (!fd) return seen;
    // Gemini's heading can be off by a lot (or flipped); trust the positions then.
    if (len(fd) > 1 && len(seen) > 0.5 && dot(unit(fd), unit(seen)) < 0.5) return fd;
    const blended: V2 = mul(add(fd, seen), 0.5);
    const cap = Math.max(len(fd) * 1.5, len(fd) + 1);
    return len(blended) > cap ? mul(unit(blended), cap) : blended;
  });
}

/** Samples the scripted (pre-contact) path of a crash vehicle over the whole clip. */
function scriptedTrack(object: SpecObject, n: number, adjustments: string[]): Track {
  const k = object.keyframes;
  const track = newTrack(n);
  const vel = keyVelocities(k);
  const mass = object.mass_kg;
  let ignoredSegments = 0;

  const segment = (i: number) => {
    // Integrate Gemini's forces from keyframe i, then correct so we land on keyframe i+1.
    const a = k[i];
    const b = k[i + 1];
    const span = b.t_s - a.t_s;
    const steps = Math.max(2, Math.ceil(span * SIM_HZ * 4));
    const h = span / steps;
    const ps: V2[] = [[a.x_m, a.y_m]];
    const vs: V2[] = [vel[i]];
    for (let s = 0; s < steps; s++) {
      const acc = mul(forceAt(object, a.t_s + s * h), 1 / mass);
      const v = add(vs[s], mul(acc, h));
      ps.push(add(ps[s], mul(add(vs[s], v), h / 2)));
      vs.push(v);
    }
    const ep = sub([b.x_m, b.y_m], ps[steps]);
    const ev = sub(vel[i + 1], vs[steps]);
    const chord = len(sub([b.x_m, b.y_m], [a.x_m, a.y_m]));
    // Forces that miss the next observed position by a lot are wrong for this segment: drop them.
    const useForces = len(ep) <= 0.35 * chord + 1.5;
    if (!useForces && object.forces.length) ignoredSegments++;
    return (t: number): V2 => {
      const u = Math.min(1, Math.max(0, (t - a.t_s) / span));
      if (useForces) {
        const idx = Math.min(steps, Math.round(u * steps));
        const h01 = -2 * u ** 3 + 3 * u ** 2;
        const h11 = u ** 3 - u ** 2;
        return add(ps[idx], add(mul(ep, h01), mul(ev, h11 * span)));
      }
      // Plain cubic Hermite through both keyframes.
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
      const h10 = u ** 3 - 2 * u ** 2 + u;
      const h01 = -2 * u ** 3 + 3 * u ** 2;
      const h11 = u ** 3 - u ** 2;
      return add(
        add(mul([a.x_m, a.y_m], h00), mul(vel[i], h10 * span)),
        add(mul([b.x_m, b.y_m], h01), mul(vel[i + 1], h11 * span)),
      );
    };
  };
  const segments = k.slice(0, -1).map((_, i) => segment(i));

  for (let s = 0; s < n; s++) {
    const t = s * DT;
    let p: V2;
    if (k.length === 1 || t <= k[0].t_s) p = add([k[0].x_m, k[0].y_m], mul(vel[0], t - k[0].t_s));
    else if (t >= k.at(-1)!.t_s) p = add([k.at(-1)!.x_m, k.at(-1)!.y_m], mul(vel.at(-1)!, t - k.at(-1)!.t_s));
    else {
      let i = 0;
      while (i < k.length - 2 && t > k[i + 1].t_s) i++;
      p = segments[i](t);
    }
    track.x[s] = p[0];
    track.y[s] = p[1];
  }
  if (ignoredSegments) adjustments.push(`ignored Gemini's forces on ${ignoredSegments} stretch(es) where they disagreed with the observed positions`);
  fillHeadings(track, object, adjustments);
  return track;
}

/** Heading follows the direction of travel (no crab-walking); below walking pace, Gemini's heading. */
function fillHeadings(track: Track, object: SpecObject, adjustments: string[], from = 0, to = track.x.length) {
  const n = track.x.length;
  const maxStep = 100 * DT; // deg per sample: 100 deg/s is a hard swerve
  let clamped = 0;
  for (let s = from; s < to; s++) {
    const a = Math.max(0, s - 1);
    const b = Math.min(n - 1, s + 1);
    const v: V2 = [(track.x[b] - track.x[a]) / ((b - a) * DT), (track.y[b] - track.y[a]) / ((b - a) * DT)];
    let heading: number;
    if (len(v) > 1) heading = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
    else heading = headingFromKeyframes(object.keyframes, s * DT);
    if (s > from) {
      const d = wrapDeg(heading - track.h[s - 1]);
      if (Math.abs(d) > maxStep) {
        heading = track.h[s - 1] + Math.sign(d) * maxStep;
        clamped++;
      } else heading = track.h[s - 1] + d;
    }
    track.h[s] = heading;
  }
  if (clamped > SIM_HZ / 2) adjustments.push("limited how fast it could turn where the observed path jittered");
}

function headingFromKeyframes(k: Keyframe[], t: number) {
  if (t <= k[0].t_s) return k[0].heading_deg;
  for (let i = 0; i < k.length - 1; i++) {
    if (t <= k[i + 1].t_s) {
      const u = (t - k[i].t_s) / Math.max(1e-6, k[i + 1].t_s - k[i].t_s);
      return k[i].heading_deg + wrapDeg(k[i + 1].heading_deg - k[i].heading_deg) * u;
    }
  }
  return k.at(-1)!.heading_deg;
}

type CrashState = {
  object: SpecObject;
  track: Track;
  adjustments: string[];
  /** Time of its first contact; before it the vehicle is "scripted" from the footage. */
  firstContact: number | null;
  stopAt: number;
};

/** Applies a position offset that ramps in over [t - window, t] and holds after. */
function blendOffset(track: Track, offset: V2, t: number, window: number) {
  const n = track.x.length;
  for (let s = 0; s < n; s++) {
    const w = smoothstep((s * DT - (t - window)) / window);
    if (w <= 0) continue;
    track.x[s] += offset[0] * w;
    track.y[s] += offset[1] * w;
  }
}

/** Replaces the track from time t0 with a friction slide (and spin) from the given state. */
function applySlide(state: CrashState, t0: number, p0: V2, v0: V2, h0: number, spinTotalDeg: number, friction: Friction, restTarget: SpecObject["rest"]) {
  const { track, adjustments } = state;
  let v = v0;
  let mu = friction.mu;
  if (restTarget) {
    const toRest = sub([restTarget.x_m, restTarget.y_m], p0);
    const distance = len(toRest);
    if (distance > 0.3 && len(v) > 0.3) {
      // Turn the slide toward where Gemini saw it stop, by at most 25 degrees.
      const angle = wrapDeg((Math.atan2(toRest[1], toRest[0]) - Math.atan2(v[1], v[0])) * (180 / Math.PI));
      const turn = Math.max(-25, Math.min(25, angle));
      if (Math.abs(turn) > 1) {
        const c = Math.cos((turn * Math.PI) / 180);
        const s = Math.sin((turn * Math.PI) / 180);
        v = [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
        adjustments.push(`slide direction nudged ${Math.round(turn)}° toward the observed rest position`);
      }
      if (Math.abs(angle) < 75) mu = muForDistance(len(v), distance * Math.cos(((angle - turn) * Math.PI) / 180), friction.range);
    }
  }
  const motion = slide(p0, v, mu);
  const n = track.x.length;
  const spinTime = Math.max(0.4, motion.stopS);
  for (let s = indexOf(t0, n); s < n; s++) {
    const tau = s * DT - t0;
    const { p } = motion.at(tau);
    track.x[s] = p[0];
    track.y[s] = p[1];
    const u = Math.min(1, Math.max(0, tau / spinTime));
    track.h[s] = h0 + spinTotalDeg * (1 - (1 - u) * (1 - u));
  }
  state.stopAt = Math.max(state.stopAt, t0 + spinTime);
  return { mu, stopS: motion.stopS };
}

export function planCrash(spec: IncidentSpec, objects: SpecObject[], n: number, friction: Friction, notes: string[]): CrashState[] {
  const crash = spec.crash!;
  const states = new Map<string, CrashState>();
  for (const object of objects) {
    if (!crash.participants.includes(object.id)) continue;
    const adjustments: string[] = [];
    states.set(object.id, { object, track: scriptedTrack(object, n, adjustments), adjustments, firstContact: null, stopAt: crash.start_s });
  }

  for (const contact of crash.contacts) {
    const A = states.get(contact.a);
    const B = states.get(contact.b);
    if (!A || !B) {
      notes.push(`Skipped a contact between ${contact.a} and ${contact.b}: one of them isn't rendered.`);
      continue;
    }
    const aFree = A.firstContact === null;
    const bFree = B.firstContact === null;
    const gapAt = (time: number, offB: V2 = [0, 0]) => {
      const a = trackAt(A.track, time);
      const b = trackAt(B.track, time);
      return bodyGap(
        { p: a.p, headingDeg: a.h, length: A.object.length_m, width: A.object.width_m },
        { p: add(b.p, offB), headingDeg: b.h, length: B.object.length_m, width: B.object.width_m },
      );
    };
    const seen = Math.min(spec.duration_s, Math.max(0, contact.t_s));
    // 1. Where the observed paths first touch, within a second of Gemini's time: no path changes at all.
    let t = Number.NaN;
    if (aFree && bFree) {
      let prev = Math.max(0, seen - 1);
      if (gapAt(prev) > -0.03) {
        for (let time = prev; time <= Math.min(spec.duration_s, seen + 1); time += 1 / 60) {
          if (gapAt(time) <= -0.03) {
            // Narrow it down to the first touch (a few centimetres of crush).
            let lo = prev;
            let hi = time;
            for (let k = 0; k < 20; k++) {
              const mid = (lo + hi) / 2;
              if (gapAt(mid) <= -0.03) hi = mid;
              else lo = mid;
            }
            t = hi;
            break;
          }
          prev = time;
        }
      }
    }
    if (Number.isFinite(t)) {
      if (Math.abs(t - seen) > 0.05) notes.push(`Contact ${A.object.label} ↔ ${B.object.label} set to ${t.toFixed(2)} s, where their observed paths first touch (Gemini said ${seen.toFixed(2)} s).`);
    } else {
      // 2. The paths miss: slide the bodies together along their closing direction, blended in beforehand.
      t = seen;
      const va0 = velocityBefore(A.track, t);
      const vb0 = velocityBefore(B.track, t);
      let along = sub(vb0, va0); // B's motion relative to A
      if (len(along) < 0.05) along = sub(trackAt(A.track, t).p, trackAt(B.track, t).p);
      const r = unit(along);
      // Search from "well before" along the approach for the first touch.
      let lambda = Number.NaN;
      if (gapAt(t, mul(r, -25)) > -0.03) {
        let prev = -25;
        for (let l = -25; l <= 25; l += 0.1) {
          if (gapAt(t, mul(r, l)) <= -0.03) {
            let lo = prev;
            let hi = l;
            for (let k = 0; k < 30; k++) {
              const mid = (lo + hi) / 2;
              if (gapAt(t, mul(r, mid)) <= -0.03) hi = mid;
              else lo = mid;
            }
            lambda = hi;
            break;
          }
          prev = l;
        }
      }
      if (!Number.isFinite(lambda) || Math.abs(lambda) > 12 || (!aFree && !bFree)) {
        notes.push(`${A.object.label} and ${B.object.label} don't meet on their observed paths near ${seen.toFixed(2)} s; no impact applied.`);
        continue;
      }
      const shareA = aFree && bFree ? 0.5 : aFree ? 1 : 0;
      const window = Math.min(3, Math.max(1, Math.abs(lambda) / 2));
      if (shareA > 0) blendOffset(A.track, mul(r, -lambda * shareA), t, window);
      if (shareA < 1) blendOffset(B.track, mul(r, lambda * (1 - shareA)), t, window);
      const moved = Math.abs(lambda) >= 0.1 ? `${Math.abs(lambda).toFixed(2)} m` : "a few centimetres";
      for (const [state, share] of [[A, shareA], [B, 1 - shareA]] as const) {
        if (share > 0) state.adjustments.push(`moved ${moved}${share < 1 ? " (shared)" : ""} over the ${window.toFixed(1)} s before impact so the bodies meet`);
      }
    }
    const pa = trackAt(A.track, t);
    const pb = trackAt(B.track, t);
    const va = velocityBefore(A.track, t);
    const vb = velocityBefore(B.track, t);

    // Collision normal (A → B): Gemini's reading if it makes the bodies close, else the face that was
    // hit, else the line of centres, else the relative velocity (which always closes).
    const candidates: V2[] = [];
    if (Number.isFinite(contact.normal_deg)) candidates.push(dirOf(contact.normal_deg));
    candidates.push(
      contactNormal(
        { p: pa.p, headingDeg: pa.h, length: A.object.length_m, width: A.object.width_m },
        { p: pb.p, headingDeg: pb.h, length: B.object.length_m, width: B.object.width_m },
      ),
    );
    if (len(sub(pb.p, pa.p)) > 0.1) candidates.push(unit(sub(pb.p, pa.p)));
    if (len(sub(va, vb)) > 0.05) candidates.push(unit(sub(va, vb)));
    let normal: V2 | null = null;
    let post: [V2, V2] | null = null;
    for (const candidate of candidates) {
      post = resolveCollision(A.object.mass_kg, B.object.mass_kg, va, vb, candidate, RESTITUTION);
      if (post) {
        normal = candidate;
        break;
      }
    }
    if (!normal || !post) {
      notes.push(`${A.object.label} and ${B.object.label} weren't moving toward each other at ${t.toFixed(2)} s; no impact applied.`);
      continue;
    }
    const bodyA: Body = { p: pa.p, headingDeg: pa.h, length: A.object.length_m, width: A.object.width_m };
    const bodyB: Body = { p: pb.p, headingDeg: pb.h, length: B.object.length_m, width: B.object.width_m };
    const startA = trackAt(A.track, t);
    const startB = trackAt(B.track, t);

    // Spin from the tangential part of the impulse acting off-centre (bounded; Gemini's rest heading wins).
    const spin = (state: CrashState, before: V2, after: V2, r: V2, h0: number) => {
      const dv = sub(after, before);
      const lever = Math.max(0.5, state.object.length_m / 2);
      const sign = Math.sign(r[0] * dv[1] - r[1] * dv[0]) || 1;
      const omega = Math.min(3, (len(dv) * 0.35) / lever); // rad/s at impact
      let total = ((omega * Math.max(0.4, len(after) / (friction.mu * 9.81))) / 2) * (180 / Math.PI) * sign;
      if (state.object.rest) total = wrapDeg(state.object.rest.heading_deg - h0);
      return Math.max(-200, Math.min(200, total));
    };
    const rA = mul(normal, reach(bodyA, normal));
    const rB = mul(normal, -reach(bodyB, normal));
    const spinA = spin(A, va, post[0], rA, startA.h);
    const spinB = spin(B, vb, post[1], rB, startB.h);
    A.firstContact ??= t;
    B.firstContact ??= t;
    const fa = applySlide(A, t, startA.p, post[0], startA.h, spinA, friction, A.object.rest);
    const fb = applySlide(B, t, startB.p, post[1], startB.h, spinB, friction, B.object.rest);
    notes.push(
      `Impact ${A.object.label} ↔ ${B.object.label} at ${t.toFixed(2)} s: closing speed ${Math.abs(dot(sub(va, vb), normal)).toFixed(1)} m/s; friction μ ${fa.mu.toFixed(2)} / ${fb.mu.toFixed(2)}.`,
    );
  }

  // After the impacts, wrecks must not drive through each other: stop a body where it would.
  const list = [...states.values()];
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const A = list[i];
        const B = list[j];
        const after = Math.max(A.firstContact ?? Infinity, B.firstContact ?? Infinity);
        if (!Number.isFinite(after) || s * DT < after + 0.25 || s === 0) continue;
        if (bodyGap(bodyOf(A.object, A.track, s), bodyOf(B.object, B.track, s)) > -0.05) continue;
        // Freeze whichever is still moving faster at its previous sample: it comes to rest against the other.
        const speed = (st: CrashState) => Math.hypot(st.track.x[s] - st.track.x[s - 1], st.track.y[s] - st.track.y[s - 1]);
        const mover = speed(A) >= speed(B) ? A : B;
        for (let q = s; q < n; q++) {
          mover.track.x[q] = mover.track.x[s - 1];
          mover.track.y[q] = mover.track.y[s - 1];
          mover.track.h[q] = mover.track.h[s - 1];
        }
        mover.stopAt = Math.min(mover.stopAt, s * DT);
        mover.adjustments.push(`came to rest against the other vehicle at ${(s * DT).toFixed(2)} s instead of passing through it`);
      }
    }
  }
  return list;
}

// ---------------------------------------------------------------------------
// Background vehicles: lane paths + IDM, then the "not involved" guard

/** A polyline sampled ~1 m apart; `line` is set when it is straight (projections are then O(1)). */
type Path = { pts: V2[]; s: Float64Array; line?: { a: V2; d: V2 } };

function makePath(pts: V2[]): Path {
  const s = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) s[i] = s[i - 1] + len(sub(pts[i], pts[i - 1]));
  return { pts, s };
}

function resample(points: V2[], step = 1): V2[] {
  const out: V2[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = len(sub(b, a));
    const count = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= count; k++) out.push(add(a, mul(sub(b, a), k / count)));
  }
  return out;
}

function pathPoint(path: Path, s: number): { p: V2; tangent: V2 } {
  const { pts, s: cum } = path;
  if (s <= 0) return { p: add(pts[0], mul(unit(sub(pts[1], pts[0])), s)), tangent: unit(sub(pts[1], pts[0])) };
  const total = cum[cum.length - 1];
  if (s >= total) {
    const t = unit(sub(pts.at(-1)!, pts.at(-2)!));
    return { p: add(pts.at(-1)!, mul(t, s - total)), tangent: t };
  }
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const k = (s - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
  return { p: add(pts[lo], mul(sub(pts[hi], pts[lo]), k)), tangent: unit(sub(pts[hi], pts[lo])) };
}

/** Arc length and lateral offset of point q relative to the path, searching near `around`. */
function project(path: Path, q: V2, around: number, ahead = 120): { s: number; lateral: number } | null {
  if (path.line) {
    const r = sub(q, path.line.a);
    const along = dot(r, path.line.d);
    return { s: along, lateral: Math.abs(r[0] * path.line.d[1] - r[1] * path.line.d[0]) };
  }
  const { pts, s: cum } = path;
  let best = Infinity;
  let result: { s: number; lateral: number } | null = null;
  // Paths are resampled at ~1 m, so arc length ≈ index.
  const from = Math.max(0, Math.floor(around) - 2);
  const to = Math.min(pts.length - 2, Math.ceil(around + ahead));
  for (let i = from; i <= to; i++) {
    const a = pts[i];
    const d = sub(pts[i + 1], a);
    const l2 = dot(d, d);
    const u = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(q, a), d) / l2)) : 0;
    const foot = add(a, mul(d, u));
    const dist = len(sub(q, foot));
    if (dist < best) {
      best = dist;
      result = { s: cum[i] + u * Math.sqrt(l2), lateral: dist };
    }
  }
  return result;
}

type Agent = {
  object: SpecObject;
  path: Path;
  parked: boolean;
  /** Facing (plan degrees) while parked. */
  parkedHeading: number;
  s0: number;
  speedAt: (t: number) => number;
  holds: { s: number; until: number }[];
  /** How many alternative placements relocate() has tried. */
  attempt?: number;
  track: Track;
  sArr: Float64Array;
  adjustments: string[];
};

function meanSpeed(k: Keyframe[]) {
  if (k.length < 2) return k[0]?.speed_mps ?? 0;
  const d = len(sub([k.at(-1)!.x_m, k.at(-1)!.y_m], [k[0].x_m, k[0].y_m]));
  return d / Math.max(0.1, k.at(-1)!.t_s - k[0].t_s);
}

/** Stopped census vehicles queue in slots per lane, so a jam doesn't stack cars on one spot. */
type QueueSlots = Map<string, number>;

/**
 * A background vehicle from the census: the lane it was in, the way it was going, and when it was on
 * screen. It drives its lane at its observed speed and passes the site while it was on camera.
 * Keyframes from pass 1, when it has them, pin where it was at that moment.
 */
function laneHintAgent(object: SpecObject, lanes: LaneModel, random: () => number, n: number, queue: QueueSlots): Agent | null {
  const hint = object.lane_hint!;
  const candidates = hint.direction === "with" ? lanes.forward : lanes.backward;
  if (!candidates.length) return null;
  const jitter = (amount: number) => (random() * 2 - 1) * amount;
  const index = Math.min(candidates.length - 1, Math.max(0, hint.lane_from_median - 1));
  const sx = hint.direction === "with" ? 1 : -1;
  const y = candidates[index] + jitter(0.15);
  const tMid = (hint.first_seen_s + hint.last_seen_s) / 2 + jitter(0.3);
  const k = object.keyframes;
  let xAnchor: number;
  if (k.length) {
    const near = k.reduce((best, f) => (Math.abs(f.t_s - tMid) < Math.abs(best.t_s - tMid) ? f : best), k[0]);
    xAnchor = near.x_m + sx * hint.speed_mps * (tMid - near.t_s);
  } else xAnchor = jitter(45);
  const adjustments = [`placed in lane ${index + 1} from the median, ${hint.direction === "with" ? "travelling +x" : "travelling -x"}, from the camera census (${hint.cameras.join(", ")})`];
  const stopped = hint.stopped || hint.speed_mps < 0.5;
  if (stopped) {
    const key = `${hint.direction}/${index}`;
    const slot = queue.get(key) ?? 0;
    queue.set(key, slot + 1);
    // Queue upstream of the crash area, one car length plus a gap per slot.
    const x = -sx * (12 + slot * (object.length_m + 2.5)) + jitter(0.4);
    const p: V2 = [x, y];
    return {
      object,
      path: makePath([p, add(p, [sx, 0])]),
      parked: true,
      parkedHeading: sx > 0 ? 0 : 180,
      s0: 0,
      speedAt: () => 0,
      holds: [],
      track: newTrack(n),
      sArr: new Float64Array(n),
      adjustments: [...adjustments, "stopped in the queue"],
    };
  }
  const reach = RUNOUT_M + 400;
  const a: V2 = [-sx * reach, y];
  const path = makePath(resample([a, [sx * reach, y]], 2));
  path.line = { a, d: [sx, 0] };
  const speed = hint.speed_mps * (1 + jitter(0.05));
  const sMid = (xAnchor - a[0]) * sx;
  return {
    object,
    path,
    parked: false,
    parkedHeading: sx > 0 ? 0 : 180,
    s0: sMid - speed * tMid,
    speedAt: () => speed,
    holds: [],
    track: newTrack(n),
    sArr: new Float64Array(n),
    adjustments,
  };
}

export function buildAgent(object: SpecObject, lanes: LaneModel | undefined, random: () => number, n: number, queue: QueueSlots): Agent | null {
  if (object.lane_hint && lanes) {
    const agent = laneHintAgent(object, lanes, random, n, queue);
    if (agent) return agent;
  }
  const k = object.keyframes;
  if (k.length === 0) return null;
  const adjustments: string[] = [];
  const first: V2 = [k[0].x_m, k[0].y_m];
  const last: V2 = [k.at(-1)!.x_m, k.at(-1)!.y_m];
  const travel = sub(last, first);
  const avg = meanSpeed(k);
  const parked = len(travel) < 2 && k.every((f) => f.speed_mps < 0.6);
  const jitter = (amount: number) => (random() * 2 - 1) * amount;

  let pts: V2[];
  let straight: Path["line"];
  const dir = len(travel) > 3 ? unit(travel) : dirOf(k[0].heading_deg);
  const alongX = Math.abs(dir[0]) > Math.cos((25 * Math.PI) / 180);
  if (parked) {
    pts = [first, add(first, mul(dirOf(k[0].heading_deg), 1))];
  } else if (lanes && alongX && (dir[0] > 0 ? lanes.forward : lanes.backward).length) {
    // Snap to the nearest lane of the right direction and run it across the site.
    const candidates = dir[0] > 0 ? lanes.forward : lanes.backward;
    const ys = k.map((f) => f.y_m).sort((a, b) => a - b);
    const median = ys[Math.floor(ys.length / 2)];
    // Nearest lane by distance from the median, always on the side this direction drives on.
    const lane = candidates.reduce((best, y) => (Math.abs(Math.abs(y) - Math.abs(median)) < Math.abs(Math.abs(best) - Math.abs(median)) ? y : best), candidates[0]);
    const y = lane + jitter(0.15);
    const sx = Math.sign(dir[0]);
    const xs = k.map((f) => f.x_m);
    const x0 = (sx > 0 ? Math.min(...xs) : Math.max(...xs)) - sx * RUNOUT_M;
    const x1 = (sx > 0 ? Math.max(...xs) : Math.min(...xs)) + sx * RUNOUT_M;
    pts = resample([[x0, y], [x1, y]]);
    straight = { a: [x0, y], d: [sx, 0] };
    if (Math.abs(lane - median) > 1.2) adjustments.push(`snapped to the nearest lane (${Math.abs(lane - median).toFixed(1)} m from Gemini's estimate)`);
  } else {
    // Gemini's path, lightly smoothed, with straight run-outs at both ends.
    let raw: V2[] = k.map((f) => [f.x_m, f.y_m]);
    raw = raw.filter((p, i) => i === 0 || len(sub(p, raw[i - 1])) > 0.5);
    if (raw.length < 2) raw = [first, add(first, mul(dir, 1))];
    for (let iter = 0; iter < 2 && raw.length > 2; iter++) {
      const next: V2[] = [raw[0]];
      for (let i = 0; i < raw.length - 1; i++) {
        next.push(add(mul(raw[i], 0.75), mul(raw[i + 1], 0.25)), add(mul(raw[i], 0.25), mul(raw[i + 1], 0.75)));
      }
      next.push(raw.at(-1)!);
      raw = next;
    }
    const startDir = unit(sub(raw[1], raw[0]));
    const endDir = unit(sub(raw.at(-1)!, raw.at(-2)!));
    pts = resample([add(raw[0], mul(startDir, -RUNOUT_M)), ...raw, add(raw.at(-1)!, mul(endDir, RUNOUT_M))]);
  }
  const path = makePath(pts);
  if (straight) path.line = straight;
  const speedScale = 1 + jitter(0.05);
  const timeShift = jitter(0.3);
  const speeds = k.map((f) => (f.speed_mps > 0.2 || avg < 0.5 ? f.speed_mps : avg));
  const speedAt = (t: number) => {
    const tt = t - timeShift;
    if (tt <= k[0].t_s) return speeds[0] * speedScale;
    for (let i = 0; i < k.length - 1; i++) {
      if (tt <= k[i + 1].t_s) {
        const u = (tt - k[i].t_s) / Math.max(1e-6, k[i + 1].t_s - k[i].t_s);
        return (speeds[i] + (speeds[i + 1] - speeds[i]) * u) * speedScale;
      }
    }
    return speeds.at(-1)! * speedScale;
  };
  const sFirst = project(path, first, 0, path.pts.length)?.s ?? RUNOUT_M;
  // Back-extrapolate from the first sighting to t = 0 at the observed speed.
  const s0 = parked ? 0 : sFirst - speedAt(k[0].t_s) * (k[0].t_s + timeShift);
  return { object, path, parked, parkedHeading: k[0].heading_deg, s0, speedAt, holds: [], track: newTrack(n), sArr: new Float64Array(n), adjustments };
}

type Obstacle = { p: V2; v: V2; length: number; width: number };

/** Intelligent Driver Model acceleration toward speed v0 behind a leader `gap` metres ahead. */
function idm(v: number, v0: number, gap: number, dv: number) {
  const aMax = 1.6;
  const b = 3;
  const sMin = 2;
  const T = 1.1;
  const free = 1 - (v / Math.max(0.1, v0)) ** 4;
  if (!Number.isFinite(gap)) return aMax * free;
  const sStar = sMin + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(aMax * b)));
  return aMax * (free - (sStar / Math.max(0.1, gap)) ** 2);
}

export function simulate(agents: Agent[], crash: CrashState[], n: number) {
  const moving = agents.filter((a) => !a.parked);
  const state = new Map<Agent, { s: number; v: number }>();
  for (const agent of agents) state.set(agent, { s: agent.s0, v: agent.parked ? 0 : agent.speedAt(0) });

  for (let step = 0; step < n; step++) {
    const t = step * DT;
    const obstacles: (Obstacle & { owner: Agent | null })[] = [];
    for (const c of crash) {
      const now = trackAt(c.track, t);
      obstacles.push({ owner: null, p: now.p, v: velocityBefore(c.track, t, DT), length: c.object.length_m, width: c.object.width_m });
    }
    for (const agent of agents) {
      const st = state.get(agent)!;
      const at = agent.parked ? { p: agent.path.pts[0], tangent: dirOf(agent.parkedHeading) } : pathPoint(agent.path, st.s);
      obstacles.push({ owner: agent, p: at.p, v: mul(at.tangent, st.v), length: agent.object.length_m, width: agent.object.width_m });
      // Record this sample.
      agent.track.x[step] = at.p[0];
      agent.track.y[step] = at.p[1];
      agent.track.h[step] = (Math.atan2(at.tangent[1], at.tangent[0]) * 180) / Math.PI;
      agent.sArr[step] = st.s;
    }
    if (step === n - 1) break;

    for (const agent of moving) {
      const st = state.get(agent)!;
      const me = pathPoint(agent.path, st.s);
      let gap = Infinity;
      let dv = 0;
      for (const o of obstacles) {
        if (o.owner === agent) continue;
        if (len(sub(o.p, me.p)) > 130) continue;
        const proj = project(agent.path, o.p, st.s, 110);
        if (!proj || proj.s <= st.s) continue;
        if (proj.lateral > agent.object.width_m / 2 + o.width / 2 + 0.4) continue;
        const g = proj.s - st.s - agent.object.length_m / 2 - o.length / 2;
        if (g < gap) {
          gap = g;
          dv = st.v - dot(o.v, me.tangent);
        }
      }
      for (const hold of agent.holds) {
        if (t > hold.until || hold.s <= st.s - 0.5) continue;
        const g = hold.s - st.s;
        if (g < gap) {
          gap = Math.max(0.05, g);
          dv = st.v;
        }
      }
      const acc = Math.max(-9, Math.min(2.5, idm(st.v, agent.speedAt(t), gap, dv)));
      st.v = Math.max(0, st.v + acc * DT);
      st.s += st.v * DT;
    }
  }
}

type Conflict = { agent: Agent; step: number; other: { kind: "crash"; state: CrashState } | { kind: "traffic"; agent: Agent } };

/**
 * One pass over the timeline: the first conflict of every vehicle that has one. Pairs further
 * apart than their combined half-lengths plus the guard are skipped before the exact footprint test.
 */
export function findConflicts(agents: Agent[], crash: CrashState[], n: number): Conflict[] {
  const found = new Map<Agent, Conflict>();
  const near = (a: Body, b: Body, guard: number) =>
    Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) < (a.length + b.length) / 2 + guard + 0.5;
  for (let step = 0; step < n; step += 2) {
    const bodies = agents.map((agent) => bodyOf(agent.object, agent.track, step));
    const crashBodies = crash.map((c) => bodyOf(c.object, c.track, step));
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      if (found.has(agent)) continue;
      for (let c = 0; c < crash.length; c++) {
        if (near(bodies[i], crashBodies[c], GUARD_CRASH_M) && bodyGap(bodies[i], crashBodies[c]) < GUARD_CRASH_M) {
          found.set(agent, { agent, step, other: { kind: "crash", state: crash[c] } });
          break;
        }
      }
      if (found.has(agent)) continue;
      for (let j = i + 1; j < agents.length; j++) {
        const other = agents[j];
        if (!near(bodies[i], bodies[j], GUARD_TRAFFIC_M) || bodyGap(bodies[i], bodies[j]) >= GUARD_TRAFFIC_M) continue;
        // The one further along its own path keeps going; the other yields.
        let yielder = other.parked || (!agent.parked && agent.sArr[step] - agent.s0 < other.sArr[step] - other.s0) ? agent : other;
        // Two stopped cars on top of each other: the one placed from the census (or listed later) moves.
        if (agent.parked && other.parked) yielder = agent.object.lane_hint && !other.object.lane_hint ? agent : other;
        if (found.has(yielder)) continue;
        found.set(yielder, { agent: yielder, step, other: { kind: "traffic", agent: yielder === agent ? other : agent } });
        if (yielder === agent) break;
      }
    }
  }
  return [...found.values()];
}

export function clearTime(conflict: Conflict, n: number): number {
  // When does the other party leave the conflict spot for good? A wreck never does.
  const spot: V2 = [conflict.agent.track.x[conflict.step], conflict.agent.track.y[conflict.step]];
  const other = conflict.other.kind === "crash" ? conflict.other.state : conflict.other.agent;
  for (let step = n - 1; step >= conflict.step; step--) {
    if (len(sub([other.track.x[step], other.track.y[step]], spot)) < other.object.length_m + conflict.agent.object.length_m + 3) {
      return Math.min((n - 1) * DT, (step + SIM_HZ) * DT);
    }
  }
  return conflict.step * DT + 1;
}

/**
 * Alternative placements for a background vehicle that can't be fitted where the footage put it:
 * the other lanes of its own carriageway (nearest first), then its timing shifted by up to ±6 s.
 * Returns false when every alternative has been used. Placement precision for background traffic
 * is allowed to slip; being drawn and staying clear of the crash is not.
 */
export function relocate(agent: Agent, lanes: LaneModel | undefined): boolean {
  agent.attempt = (agent.attempt ?? 0) + 1;
  agent.holds = [];
  const line = agent.path.line;
  const sx = line ? Math.sign(line.d[0]) : 0;
  const options: (() => void)[] = [];
  if (line && lanes && sx !== 0) {
    const candidates = (sx > 0 ? lanes.forward : lanes.backward)
      .filter((y) => Math.abs(y - line.a[1]) > 0.5)
      .sort((a, b) => Math.abs(a - line.a[1]) - Math.abs(b - line.a[1]));
    for (const y of candidates) {
      options.push(() => {
        const a: V2 = [line.a[0], y];
        const path = makePath(resample([a, add(a, mul(line.d, agent.path.s[agent.path.s.length - 1]))], 2));
        path.line = { a, d: line.d };
        agent.path = path;
      });
    }
  }
  for (const shift of [3, -3, 6, -6]) {
    options.push(() => {
      agent.s0 -= agent.speedAt(0) * shift;
    });
  }
  const next = options[agent.attempt - 1];
  if (!next) return false;
  if (agent.parked) {
    // A stopped vehicle: another lane of its carriageway first, then further back along the queue.
    const here = agent.path.pts[0];
    const forward = Math.cos((agent.parkedHeading * Math.PI) / 180) >= 0;
    const otherLanes = lanes
      ? (forward ? lanes.forward : lanes.backward).filter((y) => Math.abs(y - here[1]) > 0.5).sort((a, b) => Math.abs(a - here[1]) - Math.abs(b - here[1]))
      : [];
    const moves: V2[] = [
      ...otherLanes.map((y): V2 => [here[0], y]),
      ...[1, 2, 3, 4].map((k): V2 => add(here, mul(dirOf(agent.parkedHeading), -(agent.object.length_m + 2.5) * k))),
    ];
    const p = moves[agent.attempt - 1];
    if (!p) return false;
    agent.path = makePath([p, add(p, dirOf(agent.parkedHeading))]);
    return true;
  }
  next();
  return true;
}

/**
 * Right-hand traffic: +x traffic drives at plan y < 0 and -x traffic at y > 0. Gemini sometimes
 * measures "the lane next to the median" with the wrong sign, which puts a vehicle on the oncoming
 * carriageway. Such a vehicle is moved to the matching lane (same distance from the median) on the
 * correct side; its own lateral motion, like a swerve, is kept.
 */
export function anchorCarriageways(objects: SpecObject[], lanes: LaneModel, crashStart: number, notes: string[]) {
  for (const object of objects) {
    const k = object.keyframes;
    if (k.length < 2) continue;
    // Judge by the motion before the crash: afterwards a vehicle can end up anywhere.
    const before = k.filter((f) => f.t_s <= crashStart);
    const ref = before.length >= 2 ? before : k;
    const dx = ref.at(-1)!.x_m - ref[0].x_m;
    const dy = ref.at(-1)!.y_m - ref[0].y_m;
    if (Math.abs(dx) < 3 || Math.abs(dy) > Math.abs(dx) * Math.tan((25 * Math.PI) / 180)) continue;
    const candidates = dx > 0 ? lanes.forward : lanes.backward;
    if (!candidates.length) continue;
    const ys = ref.map((f) => f.y_m).sort((a, b) => a - b);
    const median = ys[Math.floor(ys.length / 2)];
    const wrongSide = dx > 0 ? median > 0 : median < 0;
    if (!wrongSide) continue;
    const target = candidates.reduce((best, y) => (Math.abs(Math.abs(y) - Math.abs(median)) < Math.abs(Math.abs(best) - Math.abs(median)) ? y : best), candidates[0]);
    const shift = target - median;
    for (const f of k) f.y_m += shift;
    if (object.rest) object.rest.y_m += shift;
    notes.push(`${object.label} was on the oncoming side for its direction of travel; moved ${Math.abs(shift).toFixed(1)} m onto its own carriageway.`);
  }
}

// ---------------------------------------------------------------------------

export function planMotion(spec: IncidentSpec, _options: PlanOptions): MotionPlan {
  const n = Math.floor(spec.duration_s * SIM_HZ + 1e-6) + 1;
  const vehicles: PlannedVehicle[] = [];
  const removed: MotionPlan["removed"] = [];
  for (const object of spec.objects) {
    const frames = object.keyframes;
    if (!frames.length) {
      removed.push({ id: object.id, label: object.label, reason: "no observed positions available" });
      continue;
    }
    const track = newTrack(n);
    let segment = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SIM_HZ;
      while (segment < frames.length - 2 && t > frames[segment + 1].t_s) segment++;
      const a = frames[segment];
      const b = frames[Math.min(segment + 1, frames.length - 1)];
      const u = a === b ? 0 : Math.max(0, Math.min(1, (t - a.t_s) / (b.t_s - a.t_s)));
      track.x[i] = a.x_m + (b.x_m - a.x_m) * u;
      track.y[i] = a.y_m + (b.y_m - a.y_m) * u;
      track.h[i] = a.heading_deg + wrapDeg(b.heading_deg - a.heading_deg) * u;
    }
    vehicles.push({ object, track, adjustments: [] });
  }
  return {
    duration: spec.duration_s, samples: n, vehicles, removed,
    crash: spec.crash ? { start_s: spec.crash.start_s, end_s: spec.crash.end_s, participants: spec.crash.participants.filter((id) => vehicles.some((v) => v.object.id === id)) } : null,
    notes: ["Positions are interpolated between reported observations and held outside them. Occlusions and uncalibrated footage limit accuracy; contact and forces are not independently measured."],
  };
}
