import type { StaticObject } from "@/gemini/spec";

export type CollisionPose = { x: number; z: number; yaw: number };
export type EllipseFootprint = { radiusX: number; radiusZ: number; centerZ?: number };
export type CollisionBodyState = {
  pose: CollisionPose;
  velocityX: number;
  velocityZ: number;
  yawRate: number;
  massKg: number;
  footprint: EllipseFootprint;
};
export type CollisionBodyVelocity = { velocityX: number; velocityZ: number; yawRate: number };
export type Contact = { time: number; normalX: number; normalZ: number };

type Point = { x: number; z: number };

/** Fixed convex footprint in scene coordinates. Normals always point from vehicle a to object b. */
export type StaticCollisionObject = {
  id: string;
  footprint: Point[];
  height: number;
  immovable: true;
  inverseMass: 0;
  velocityX: 0;
  velocityZ: 0;
  yawRate: 0;
  friction: number;
  restitution: number;
  stiffnessNPerM: number;
};

export function staticCollisionGeometry(object: StaticObject): StaticCollisionObject {
  return {
    id: object.id,
    footprint: object.footprint_m.map(([x, y]) => ({ x, z: -y })),
    height: object.height_m,
    immovable: true,
    inverseMass: 0,
    velocityX: 0,
    velocityZ: 0,
    yawRate: 0,
    friction: object.friction,
    restitution: object.restitution,
    stiffnessNPerM: object.stiffness_n_per_m,
  };
}

export function planNormalToScene(normalDeg: number): Point {
  const angle = normalDeg * Math.PI / 180;
  return { x: Math.cos(angle), z: -Math.sin(angle) };
}

const POLYGON_SIDES = 48;
const CONTACT_STEP = 1 / 120;
const RESTITUTION = 0.15;
const GROUND_FRICTION = 0.75;
const GRAVITY = 9.81;

function ellipsePoints(pose: CollisionPose, footprint: EllipseFootprint): Point[] {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  return Array.from({ length: POLYGON_SIDES }, (_, index) => {
    const angle = (index / POLYGON_SIDES) * Math.PI * 2;
    const localX = footprint.radiusX * Math.cos(angle);
    const localZ = (footprint.centerZ ?? 0) + footprint.radiusZ * Math.sin(angle);
    return {
      x: pose.x + c * localX + s * localZ,
      z: pose.z - s * localX + c * localZ,
    };
  });
}

function separatingAxisContact(first: Point[], second: Point[], centerDelta: Point) {
  let minimumOverlap = Number.POSITIVE_INFINITY;
  let normalX = 0;
  let normalZ = 0;

  for (const polygon of [first, second]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      let axisX = end.z - start.z;
      let axisZ = start.x - end.x;
      const axisLength = Math.hypot(axisX, axisZ);
      if (axisLength <= 1e-12) continue;
      axisX /= axisLength;
      axisZ /= axisLength;

      let firstMin = Number.POSITIVE_INFINITY;
      let firstMax = Number.NEGATIVE_INFINITY;
      let secondMin = Number.POSITIVE_INFINITY;
      let secondMax = Number.NEGATIVE_INFINITY;
      for (const point of first) {
        const projection = point.x * axisX + point.z * axisZ;
        firstMin = Math.min(firstMin, projection);
        firstMax = Math.max(firstMax, projection);
      }
      for (const point of second) {
        const projection = point.x * axisX + point.z * axisZ;
        secondMin = Math.min(secondMin, projection);
        secondMax = Math.max(secondMax, projection);
      }

      const overlap = Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin);
      if (overlap < -1e-8) return null;
      if (overlap < minimumOverlap) {
        minimumOverlap = overlap;
        if (centerDelta.x * axisX + centerDelta.z * axisZ < 0) {
          axisX = -axisX;
          axisZ = -axisZ;
        }
        normalX = axisX;
        normalZ = axisZ;
      }
    }
  }

  return { normalX, normalZ };
}

/** Contact against the same fixed footprint used by the renderer (convex measured polygons). */
export function ellipseStaticContactAt(
  pose: CollisionPose,
  footprint: EllipseFootprint,
  object: StaticCollisionObject,
): Omit<Contact, "time"> | null {
  if (object.footprint.length < 3) return null;
  const center = object.footprint.reduce((sum, p) => ({ x: sum.x + p.x, z: sum.z + p.z }), { x: 0, z: 0 });
  return separatingAxisContact(ellipsePoints(pose, footprint), object.footprint, {
    x: center.x / object.footprint.length - pose.x,
    z: center.z / object.footprint.length - pose.z,
  });
}

export function findFirstEllipseStaticContact(
  vehicleAt: (time: number) => CollisionPose,
  footprint: EllipseFootprint,
  object: StaticCollisionObject,
  duration: number,
): Contact | null {
  const at = (time: number) => {
    const normal = ellipseStaticContactAt(vehicleAt(time), footprint, object);
    return normal ? { time, ...normal } : null;
  };
  const initial = at(0);
  if (initial) return initial;
  for (let t = CONTACT_STEP; t < duration + CONTACT_STEP; t += CONTACT_STEP) {
    const highTime = Math.min(t, duration);
    if (at(highTime)) {
      let low = Math.max(0, t - CONTACT_STEP);
      let high = highTime;
      for (let i = 0; i < 24; i += 1) {
        const middle = (low + high) / 2;
        if (at(middle)) high = middle;
        else low = middle;
      }
      return at(high);
    }
    if (highTime === duration) break;
  }
  return null;
}

function contactAt(
  time: number,
  firstAt: (time: number) => CollisionPose,
  secondAt: (time: number) => CollisionPose,
  firstFootprint: EllipseFootprint,
  secondFootprint: EllipseFootprint,
) {
  const firstPose = firstAt(time);
  const secondPose = secondAt(time);
  const normal = separatingAxisContact(
    ellipsePoints(firstPose, firstFootprint),
    ellipsePoints(secondPose, secondFootprint),
    { x: secondPose.x - firstPose.x, z: secondPose.z - firstPose.z },
  );
  return normal ? { time, ...normal } : null;
}

export function findFirstEllipseContact(
  firstAt: (time: number) => CollisionPose,
  secondAt: (time: number) => CollisionPose,
  firstFootprint: EllipseFootprint,
  secondFootprint: EllipseFootprint,
  duration: number,
): Contact | null {
  const initial = contactAt(0, firstAt, secondAt, firstFootprint, secondFootprint);
  if (initial) return initial;

  let previousTime = 0;
  for (let time = CONTACT_STEP; time < duration + CONTACT_STEP / 2; time += CONTACT_STEP) {
    const sampleTime = Math.min(time, duration);
    const contact = contactAt(sampleTime, firstAt, secondAt, firstFootprint, secondFootprint);
    if (contact) {
      let low = previousTime;
      let high = sampleTime;
      for (let iteration = 0; iteration < 24; iteration += 1) {
        const middle = (low + high) / 2;
        if (contactAt(middle, firstAt, secondAt, firstFootprint, secondFootprint)) high = middle;
        else low = middle;
      }
      return contactAt(high, firstAt, secondAt, firstFootprint, secondFootprint);
    }
    previousTime = sampleTime;
  }
  return null;
}

function supportOffset(footprint: EllipseFootprint, yaw: number, directionX: number, directionZ: number): Point {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const localX = c * directionX - s * directionZ;
  const localZ = s * directionX + c * directionZ;
  const centerZ = footprint.centerZ ?? 0;
  const denominator = Math.hypot(footprint.radiusX * localX, footprint.radiusZ * localZ);
  if (denominator <= 1e-12) return { x: s * centerZ, z: c * centerZ };
  const offsetX = (footprint.radiusX ** 2 * localX) / denominator;
  const offsetZ = centerZ + (footprint.radiusZ ** 2 * localZ) / denominator;
  return {
    x: c * offsetX + s * offsetZ,
    z: -s * offsetX + c * offsetZ,
  };
}

const cross = (a: Point, b: Point) => a.x * b.z - a.z * b.x;

export function resolveEllipseImpact(
  first: CollisionBodyState,
  second: CollisionBodyState,
  normal: Point,
): [CollisionBodyVelocity, CollisionBodyVelocity] | null {
  const normalLength = Math.hypot(normal.x, normal.z);
  if (normalLength <= 1e-12) return null;
  const n = { x: normal.x / normalLength, z: normal.z / normalLength };
  const firstContact = supportOffset(first.footprint, first.pose.yaw, n.x, n.z);
  const secondContact = supportOffset(second.footprint, second.pose.yaw, -n.x, -n.z);
  const firstContactVelocity = {
    x: first.velocityX + first.yawRate * firstContact.z,
    z: first.velocityZ - first.yawRate * firstContact.x,
  };
  const secondContactVelocity = {
    x: second.velocityX + second.yawRate * secondContact.z,
    z: second.velocityZ - second.yawRate * secondContact.x,
  };
  const closingSpeed =
    (secondContactVelocity.x - firstContactVelocity.x) * n.x +
    (secondContactVelocity.z - firstContactVelocity.z) * n.z;
  if (closingSpeed >= -1e-9) return null;

  const firstInertia =
    (first.massKg * (first.footprint.radiusX ** 2 + first.footprint.radiusZ ** 2)) / 3 +
    first.massKg * (first.footprint.centerZ ?? 0) ** 2;
  const secondInertia =
    (second.massKg * (second.footprint.radiusX ** 2 + second.footprint.radiusZ ** 2)) / 3 +
    second.massKg * (second.footprint.centerZ ?? 0) ** 2;
  const firstLever = cross(firstContact, n);
  const secondLever = cross(secondContact, n);
  const effectiveInverseMass =
    1 / first.massKg +
    1 / second.massKg +
    firstLever ** 2 / firstInertia +
    secondLever ** 2 / secondInertia;
  const impulse = (-(1 + RESTITUTION) * closingSpeed) / effectiveInverseMass;

  return [
    {
      velocityX: first.velocityX - (impulse * n.x) / first.massKg,
      velocityZ: first.velocityZ - (impulse * n.z) / first.massKg,
      yawRate: first.yawRate + (impulse * firstLever) / firstInertia,
    },
    {
      velocityX: second.velocityX + (impulse * n.x) / second.massKg,
      velocityZ: second.velocityZ + (impulse * n.z) / second.massKg,
      yawRate: second.yawRate - (impulse * secondLever) / secondInertia,
    },
  ];
}

/** Infinite-mass counterpart of resolveEllipseImpact; returns a zero-motion static body.
 * Replaying measured tracks never invokes this response to rewrite the observed motion.
 */
export function resolveEllipseStaticImpact(
  vehicle: CollisionBodyState,
  object: StaticCollisionObject,
  normal: Point,
): [CollisionBodyVelocity, CollisionBodyVelocity] | null {
  const length = Math.hypot(normal.x, normal.z);
  if (length < 1e-12 || vehicle.massKg <= 0) return null;
  const n = { x: normal.x / length, z: normal.z / length };
  const r = supportOffset(vehicle.footprint, vehicle.pose.yaw, n.x, n.z);
  const inertia = vehicle.massKg * ((vehicle.footprint.radiusX ** 2 + vehicle.footprint.radiusZ ** 2) / 3 + (vehicle.footprint.centerZ ?? 0) ** 2);
  if (inertia <= 0) return null;
  const contactVelocity = {
    x: vehicle.velocityX + vehicle.yawRate * r.z,
    z: vehicle.velocityZ - vehicle.yawRate * r.x,
  };
  const closing = contactVelocity.x * n.x + contactVelocity.z * n.z;
  if (closing <= 1e-9) return null;
  const lever = cross(r, n);
  const inverseMass = 1 / vehicle.massKg;
  const impulse = (1 + Math.max(0, Math.min(1, object.restitution))) * closing / (inverseMass + lever ** 2 / inertia);
  const tangent = { x: -n.z, z: n.x };
  const tangentLever = cross(r, tangent);
  // Normal response changes contact tangent velocity too when the lever arms are nonzero.
  const angularAfterNormal = vehicle.yawRate + impulse * lever / inertia;
  const tangentSpeed = (vehicle.velocityX - impulse * n.x * inverseMass + angularAfterNormal * r.z) * tangent.x
    + (vehicle.velocityZ - impulse * n.z * inverseMass - angularAfterNormal * r.x) * tangent.z;
  const tangentImpulse = Math.max(-object.friction * impulse, Math.min(object.friction * impulse,
    tangentSpeed / (inverseMass + tangentLever ** 2 / inertia)));
  return [{
    velocityX: vehicle.velocityX - (impulse * n.x + tangentImpulse * tangent.x) * inverseMass,
    velocityZ: vehicle.velocityZ - (impulse * n.z + tangentImpulse * tangent.z) * inverseMass,
    yawRate: angularAfterNormal + tangentImpulse * tangentLever / inertia,
  }, { velocityX: 0, velocityZ: 0, yawRate: 0 }];
}

export function postImpactPosition(
  position: Point,
  velocityX: number,
  velocityZ: number,
  elapsed: number,
): Point {
  const speed = Math.hypot(velocityX, velocityZ);
  if (speed <= 1e-12 || elapsed <= 0) return position;
  const deceleration = GROUND_FRICTION * GRAVITY;
  const movingTime = Math.min(elapsed, speed / deceleration);
  const distance = speed * movingTime - 0.5 * deceleration * movingTime ** 2;
  const ratio = distance / speed;
  return { x: position.x + velocityX * ratio, z: position.z + velocityZ * ratio };
}

export function stoppingTime(velocityX: number, velocityZ: number): number {
  return Math.hypot(velocityX, velocityZ) / (GROUND_FRICTION * GRAVITY);
}
