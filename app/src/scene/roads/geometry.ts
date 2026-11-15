import * as THREE from "three";

/*
 * 2D plan geometry (x, z) for roads, plus a batch that turns plan shapes into flat,
 * non-indexed triangles with explicit normals so many pieces share one draw call.
 *
 * Orientation convention: for a heading d = (dx, dz), the right-hand side is
 * (-dz, dx). That is the driver's right when the scene is seen from above with +x to
 * the right and -z up, so right-hand traffic keeps to this side.
 */

export type P = [number, number];

export const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
export const len = (a: P) => Math.hypot(a[0], a[1]);
export const norm = (a: P): P => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
export const right = (d: P): P => [-d[1], d[0]];
export const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: P, b: P) => a[0] * b[1] - a[1] * b[0];
export const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const dir = (angle: number): P => [Math.cos(angle), Math.sin(angle)];

/** Point at distance `s` along unit `u` from `origin`, shifted `t` to the right of `u`. */
export const frame = (origin: P, u: P) => (s: number, t: number): P => add(add(origin, mul(u, s)), mul(right(u), t));

/** Points on a circle from angle a0 to a1 (radians, either direction), about `step` metres apart. */
export function arc(center: P, radius: number, a0: number, a1: number, step = 0.6): P[] {
  const count = Math.max(2, Math.ceil((Math.abs(a1 - a0) * radius) / step));
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / count;
    return [center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius] as P;
  });
}

/** Shortest arc around `center` from p0 to p1 (both assumed on the circle). */
export function arcBetween(center: P, p0: P, p1: P, step = 0.6): P[] {
  const a0 = Math.atan2(p0[1] - center[1], p0[0] - center[0]);
  let a1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
  while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
  while (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
  return arc(center, len(sub(p0, center)), a0, a1, step);
}

export function polylineLength(points: P[]) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += len(sub(points[i], points[i - 1]));
  return total;
}

/** Offsets a polyline sideways (positive = right), with mitred joins. */
export function offsetPolyline(points: P[], distance: number): P[] {
  const n = points.length;
  const normals: P[] = [];
  for (let i = 0; i < n - 1; i += 1) normals.push(right(norm(sub(points[i + 1], points[i]))));
  return points.map((p, i) => {
    if (i === 0) return add(p, mul(normals[0], distance));
    if (i === n - 1) return add(p, mul(normals[n - 2], distance));
    const a = normals[i - 1];
    const b = normals[i];
    const m = norm(add(a, b));
    const cos = Math.max(0.35, dot(m, a));
    return add(p, mul(m, distance / cos));
  });
}

export type RoundedCorner = {
  /** The sharp corner that was replaced. */
  corner: P;
  arc: P[];
  /** > 0 when the polyline turns right (toward its right-hand side). */
  turn: number;
};

/**
 * Replaces interior vertices with circular arcs of the given radii (0 keeps the corner).
 * Returns the new polyline, the arcs, and for every output segment the index of the
 * input segment it came from (arcs count as the outgoing segment).
 */
export function roundCorners(points: P[], radii: number[]) {
  const out: P[] = [points[0]];
  const segment: number[] = [];
  const corners: RoundedCorner[] = [];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const radius = radii[i] ?? 0;
    const d0 = norm(sub(corner, prev));
    const d1 = norm(sub(next, corner));
    const turn = cross(d0, d1);
    const angle = Math.acos(Math.min(1, Math.max(-1, dot(d0, d1))));
    if (radius <= 0 || angle < 1e-3) {
      out.push(corner);
      segment.push(i - 1);
      continue;
    }
    // Tangent length, clamped so neighbouring arcs never overlap.
    const limit = Math.min(len(sub(corner, prev)), len(sub(next, corner))) * 0.5;
    const tangent = Math.min(radius * Math.tan(angle / 2), limit);
    const r = tangent / Math.tan(angle / 2);
    const t0 = sub(corner, mul(d0, tangent));
    const t1 = add(corner, mul(d1, tangent));
    const center = add(t0, mul(right(d0), Math.sign(turn) * r));
    const curve = arcBetween(center, t0, t1, 0.4);
    out.push(t0);
    segment.push(i - 1);
    for (let k = 1; k < curve.length; k += 1) {
      out.push(curve[k]);
      segment.push(i);
    }
    corners.push({ corner, arc: curve, turn });
  }
  out.push(points[points.length - 1]);
  segment.push(points.length - 2);
  return { points: out, segment, corners };
}

/** Splits a polyline into dashes; `phase` is how far into the dash+gap pattern the first point is. */
export function dashes(points: P[], dash: number, gap: number, phase = 0): P[][] {
  const period = dash + gap;
  const result: P[][] = [];
  let pos = ((phase % period) + period) % period;
  let current: P[] | null = null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const length = len(sub(b, a));
    let s = 0;
    while (s < length - 1e-9) {
      if (pos < dash) {
        const step = Math.min(dash - pos, length - s);
        if (!current) current = [lerp(a, b, s / length)];
        s += step;
        pos += step;
        current.push(lerp(a, b, s / length));
        if (pos >= dash - 1e-9) {
          result.push(current);
          current = null;
        }
      } else {
        const step = Math.min(period - pos, length - s);
        s += step;
        pos += step;
        if (pos >= period - 1e-9) pos = 0;
      }
    }
  }
  if (current && current.length > 1) result.push(current);
  return result;
}

/** Intersections of two circles (empty when they do not meet). */
export function circleIntersections(c0: P, r0: number, c1: P, r1: number): P[] {
  const d = len(sub(c1, c0));
  if (d > r0 + r1 || d < Math.abs(r0 - r1) || d === 0) return [];
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
  const u = norm(sub(c1, c0));
  const m = add(c0, mul(u, a));
  return [add(m, mul(right(u), h)), sub(m, mul(right(u), h))];
}

// ---------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);

/** Accumulates triangles that share one material; `build` makes a single mesh. */
export class MeshBatch {
  private positions: number[] = [];
  private normals: number[] = [];
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();
  private n = new THREE.Vector3();

  get empty() {
    return this.positions.length === 0;
  }

  /** Adds a triangle, flipped if needed so its normal points along `facing`. */
  tri(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, facing: THREE.Vector3Like = UP) {
    this.a.copy(a);
    this.b.copy(b);
    this.c.copy(c);
    this.n.subVectors(this.b, this.a).cross(this.c.clone().sub(this.a));
    if (this.n.lengthSq() < 1e-12) return;
    this.n.normalize();
    let [p, q, r] = [this.a, this.b, this.c];
    if (this.n.dot(facing as THREE.Vector3) < 0) {
      [q, r] = [r, q];
      this.n.negate();
    }
    for (const v of [p, q, r]) {
      this.positions.push(v.x, v.y, v.z);
      this.normals.push(this.n.x, this.n.y, this.n.z);
    }
  }

  quad(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like, facing: THREE.Vector3Like = UP) {
    this.tri(a, b, c, facing);
    this.tri(a, c, d, facing);
  }

  /** Flat polygon (with optional holes) at height y, facing up. */
  floor(outline: P[], y: number, holes: P[][] = []) {
    const contour = outline.map(([x, z]) => new THREE.Vector2(x, z));
    const holeVectors = holes.map((hole) => hole.map(([x, z]) => new THREE.Vector2(x, z)));
    const all = [...contour, ...holeVectors.flat()];
    const faces = THREE.ShapeUtils.triangulateShape(contour, holeVectors);
    for (const [i, j, k] of faces) {
      this.tri(
        { x: all[i].x, y, z: all[i].y },
        { x: all[j].x, y, z: all[j].y },
        { x: all[k].x, y, z: all[k].y },
      );
    }
  }

  /** Band between two matching polylines, at heights yLeft / yRight (allows a gentle slope). */
  ribbon(left: P[], rightSide: P[], yLeft: number, yRight = yLeft) {
    for (let i = 0; i < left.length - 1; i += 1) {
      this.quad(
        { x: left[i][0], y: yLeft, z: left[i][1] },
        { x: rightSide[i][0], y: yRight, z: rightSide[i][1] },
        { x: rightSide[i + 1][0], y: yRight, z: rightSide[i + 1][1] },
        { x: left[i + 1][0], y: yLeft, z: left[i + 1][1] },
      );
    }
  }

  /** Vertical faces along a polyline from y0 to y1, facing its left (-1) or right (+1) side. */
  wall(points: P[], y0: number, y1: number, side: 1 | -1) {
    for (let i = 0; i < points.length - 1; i += 1) {
      const [ax, az] = points[i];
      const [bx, bz] = points[i + 1];
      const [nx, nz] = mul(right(norm([bx - ax, bz - az])), side);
      this.quad(
        { x: ax, y: y0, z: az },
        { x: bx, y: y0, z: bz },
        { x: bx, y: y1, z: bz },
        { x: ax, y: y1, z: az },
        { x: nx, y: 0, z: nz },
      );
    }
  }

  build(material: THREE.Material) {
    if (this.empty) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, material);
  }
}
