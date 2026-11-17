/**
 * Small 2D physics kit for the engine, in the plan (ground) frame.
 *
 * resolveCollision and slide are TypeScript ports of the pipeline's collision model
 * (pipeline/src/reconstruct/collision_physics.py): a frictionless point-contact impulse
 * with a coefficient of restitution, then constant-deceleration Coulomb friction until the
 * vehicle stops.
 */

export type V2 = [number, number];

export const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
export const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
export const len = (a: V2) => Math.hypot(a[0], a[1]);
export const unit = (a: V2): V2 => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l] : [1, 0];
};
export const dirOf = (deg: number): V2 => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
export const degOf = (v: V2) => (Math.atan2(v[1], v[0]) * 180) / Math.PI;
export const wrapDeg = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
export const smoothstep = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};

export const GRAVITY = 9.81;

/**
 * Velocities just after a collision. The normal points from body 1 to body 2. Tangential velocity is
 * unchanged; the normal components conserve momentum and satisfy Newton's restitution law.
 * Returns null when the bodies aren't closing along the normal (no impulse to apply).
 */
export function resolveCollision(m1: number, m2: number, v1: V2, v2: V2, normal: V2, restitution: number): [V2, V2] | null {
  const n = unit(normal);
  const u1 = dot(v1, n);
  const u2 = dot(v2, n);
  if (u2 - u1 >= -1e-9) return null;
  const total = m1 + m2;
  const w1 = (m1 * u1 + m2 * u2 - m2 * restitution * (u1 - u2)) / total;
  const w2 = (m1 * u1 + m2 * u2 + m1 * restitution * (u1 - u2)) / total;
  return [add(v1, mul(n, w1 - u1)), add(v2, mul(n, w2 - u2))];
}

/** Friction slide from p0 at v0: position, velocity and stop time `stopS` after the start. */
export function slide(p0: V2, v0: V2, mu: number) {
  const speed = len(v0);
  const decel = mu * GRAVITY;
  const stopS = speed < 1e-6 || decel <= 0 ? 0 : speed / decel;
  const dir = unit(v0);
  return {
    stopS,
    distance: decel > 0 ? (speed * speed) / (2 * decel) : Infinity,
    at(tau: number): { p: V2; v: V2 } {
      if (speed < 1e-6) return { p: p0, v: [0, 0] };
      const t = Math.min(Math.max(0, tau), stopS);
      const s = speed * t - 0.5 * decel * t * t;
      return { p: add(p0, mul(dir, s)), v: mul(dir, speed - decel * t) };
    },
  };
}

/** Friction coefficient that makes a slide from `speed` cover `distance`, clamped to `range`. */
export function muForDistance(speed: number, distance: number, range: [number, number]) {
  if (!(distance > 0.05) || speed < 0.1) return (range[0] + range[1]) / 2;
  return Math.min(range[1], Math.max(range[0], (speed * speed) / (2 * GRAVITY * distance)));
}

/** A vehicle's footprint on the ground. */
export type Body = { p: V2; headingDeg: number; length: number; width: number };

function corners(b: Body): V2[] {
  const f = dirOf(b.headingDeg);
  const l: V2 = [-f[1], f[0]];
  const hl = b.length / 2;
  const hw = b.width / 2;
  return [
    add(b.p, add(mul(f, hl), mul(l, hw))),
    add(b.p, add(mul(f, hl), mul(l, -hw))),
    add(b.p, add(mul(f, -hl), mul(l, -hw))),
    add(b.p, add(mul(f, -hl), mul(l, hw))),
  ];
}

/**
 * Separating-axis gap between two footprints (m): positive = clear by that much (a lower bound
 * on the true distance), negative = overlapping by roughly that much.
 */
export function bodyGap(a: Body, b: Body): number {
  const ca = corners(a);
  const cb = corners(b);
  const axes: V2[] = [dirOf(a.headingDeg), dirOf(a.headingDeg + 90), dirOf(b.headingDeg), dirOf(b.headingDeg + 90)];
  let best = -Infinity;
  for (const axis of axes) {
    const pa = ca.map((c) => dot(c, axis));
    const pb = cb.map((c) => dot(c, axis));
    const gap = Math.max(Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
    best = Math.max(best, gap);
  }
  return best;
}

/**
 * Contact normal between two touching footprints, pointing from a to b: the separating axis with
 * the least penetration (the face that was hit).
 */
export function contactNormal(a: Body, b: Body): V2 {
  const ca = corners(a);
  const cb = corners(b);
  const axes: V2[] = [dirOf(a.headingDeg), dirOf(a.headingDeg + 90), dirOf(b.headingDeg), dirOf(b.headingDeg + 90)];
  let best = -Infinity;
  let normal: V2 = unit(sub(b.p, a.p));
  for (const axis of axes) {
    const pa = ca.map((c) => dot(c, axis));
    const pb = cb.map((c) => dot(c, axis));
    const gap = Math.max(Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
    if (gap > best) {
      best = gap;
      normal = dot(sub(b.p, a.p), axis) >= 0 ? axis : mul(axis, -1);
    }
  }
  return normal;
}

/** Half-extent of a footprint along a direction: how far its edge reaches from its centre. */
export function reach(b: Body, along: V2): number {
  const f = dirOf(b.headingDeg);
  const l: V2 = [-f[1], f[0]];
  const n = unit(along);
  return Math.abs(dot(n, f)) * (b.length / 2) + Math.abs(dot(n, l)) * (b.width / 2);
}

/** Deterministic PRNG (mulberry32), so a stored seed rebuilds the same scene. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
