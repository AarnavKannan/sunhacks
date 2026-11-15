import assert from "node:assert/strict";
import test from "node:test";
import {
  findFirstEllipseContact,
  postImpactPosition,
  resolveEllipseImpact,
  stoppingTime,
} from "../src/scene/collision.ts";

const circle = { radiusX: 1, radiusZ: 1 };

test("larger ellipse footprints cause earlier contact", () => {
  const moving = (radius) =>
    findFirstEllipseContact(
      (time) => ({ x: -5 + time, z: 0, yaw: 0 }),
      () => ({ x: 0, z: 0, yaw: 0 }),
      { radiusX: radius, radiusZ: radius },
      circle,
      5,
    );

  const small = moving(0.5);
  const large = moving(1.5);
  assert.ok(small);
  assert.ok(large);
  assert.ok(large.time < small.time);
});

test("separated ellipse paths do not collide", () => {
  const contact = findFirstEllipseContact(
    (time) => ({ x: -5 + time * 2, z: 4, yaw: 0 }),
    () => ({ x: 0, z: 0, yaw: 0 }),
    circle,
    circle,
    5,
  );
  assert.equal(contact, null);
});

test("ellipse impact conserves momentum and separates closing vehicles", () => {
  const [first, second] = resolveEllipseImpact(
    {
      pose: { x: -1, z: 0, yaw: 0 },
      velocityX: 2,
      velocityZ: 0,
      yawRate: 0,
      massKg: 1500,
      footprint: circle,
    },
    {
      pose: { x: 1, z: 0, yaw: 0 },
      velocityX: -1,
      velocityZ: 0,
      yawRate: 0,
      massKg: 2000,
      footprint: circle,
    },
    { x: 1, z: 0 },
  ) ?? [];

  assert.ok(first);
  assert.ok(second);
  assert.ok(second.velocityX - first.velocityX > 0);
  assert.ok(Math.abs(1500 * first.velocityX + 2000 * second.velocityX - 1000) < 1e-8);
  assert.ok(Math.abs(second.velocityX - first.velocityX - 0.45) < 1e-8);
});

test("off-center ellipse contact produces angular response", () => {
  const normal = { x: 0.8, z: 0.6 };
  const denominator = Math.hypot(normal.x, 2 * normal.z);
  const offset = { x: normal.x / denominator, z: (4 * normal.z) / denominator };
  const footprint = { radiusX: 1, radiusZ: 2 };
  const resolved = resolveEllipseImpact(
    {
      pose: { x: 0, z: 0, yaw: 0 },
      velocityX: 2 * normal.x,
      velocityZ: 2 * normal.z,
      yawRate: 0,
      massKg: 1500,
      footprint,
    },
    {
      pose: { x: 2 * offset.x, z: 2 * offset.z, yaw: 0 },
      velocityX: -normal.x,
      velocityZ: -normal.z,
      yawRate: 0,
      massKg: 2000,
      footprint,
    },
    normal,
  );
  assert.ok(resolved);
  assert.ok(Math.abs(resolved[0].yawRate) > 0);
  assert.ok(Math.abs(resolved[1].yawRate) > 0);
});

test("post-impact motion stops at the Coulomb-friction stopping distance", () => {
  const stop = stoppingTime(10, 0);
  const stopped = postImpactPosition({ x: 2, z: -3 }, 10, 0, stop * 2);
  assert.ok(Math.abs(stopped.x - (2 + 10 * stop / 2)) < 1e-8);
  assert.equal(stopped.z, -3);
});
