// Runs real scene/motion/geometry/kinematics on an explicitly SYNTHETIC fixture by default.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import * as THREE from "three";
import { buildGeminiScene } from "../../../../src/gemini/engine.ts";
import { planMotion, trackAt } from "../../../../src/gemini/motion.ts";
import type { IncidentSpec, StaticObject } from "../../../../src/gemini/spec.ts";
import { Painter, ROAD_Y } from "../../../../src/scene/draw.ts";
import type { Surfaces } from "../../../../src/scene/environment.ts";
import { ellipseStaticContactAt, findFirstEllipseStaticContact, planNormalToScene, resolveEllipseStaticImpact, staticCollisionGeometry } from "../../../../src/scene/collision.ts";
import { deriveSceneKinematics, registerSceneSpec } from "../../../../src/kinematics/derive.ts";

const here = dirname(fileURLToPath(import.meta.url));
const path = process.argv[2] ?? join(here, "incident-spec.json");
const spec: IncidentSpec = JSON.parse(readFileSync(path, "utf8"));
const start = performance.now();
const plan = planMotion(spec, { seed: 1, friction: { mu: 0.8, range: [0.7, 0.9] } });
assert.equal(plan.removed.length, 0, "no track may disappear");
assert.equal(plan.vehicles.length, spec.objects.length);
let worst = 0;
for (const v of plan.vehicles) for (const k of v.object.keyframes) {
  const { p } = trackAt(v.track, k.t_s);
  worst = Math.max(worst, Math.hypot(p[0] - k.x_m, p[1] - k.y_m));
}
assert(worst < 1e-6, `keyframe error ${worst}`);
const built = buildGeminiScene({ id: "w3-measured-check", spec, seed: 1, created: "2026-11-15" });
const group = new THREE.Group();
const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
const surfaces = Object.fromEntries(["road", "island", "concrete", "sidewalk", "verge", "metal", "paintWhite", "paintYellow", "ground"].map((k) => [k, material])) as Surfaces;
const painter = new Painter(group, surfaces, built.layout.site);
const marks: number[] = [];
let genericBarrier = 0;
const styled = painter.styled.bind(painter);
painter.styled = (points, ...args) => { marks.push(points[0][1]); styled(points, ...args); };
const barrier = painter.barrier.bind(painter);
painter.barrier = (...args) => { genericBarrier++; barrier(...args); };
built.layout.build(painter);
assert.deepEqual(marks, [...spec.road.lane_lines_forward_m!, ...spec.road.lane_lines_backward_m!.map((x) => -x)], "retain every measured painted line");
assert.equal(genericBarrier, spec.static_objects?.length ? 0 : 1, "suppress generic center barrier beside measured objects");
for (const object of spec.static_objects ?? []) {
  const mesh = group.getObjectByName(object.id) as THREE.Mesh;
  assert(mesh?.isMesh, `missing fixed mesh ${object.id}`);
  const c = mesh.userData.collision;
  assert.deepEqual(c.footprint, object.footprint_m.map(([x, y]) => ({ x, z: -y })));
  assert.deepEqual([c.inverseMass, c.velocityX, c.velocityZ, c.yawRate], [0, 0, 0, 0]);
  const box = new THREE.Box3().setFromObject(mesh);
  const xs = object.footprint_m.map(([x]) => x), zs = object.footprint_m.map(([, y]) => -y);
  const actual = [box.min.x, box.max.x, box.min.z, box.max.z, box.min.y, box.max.y];
  const want = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), ROAD_Y, ROAD_Y + object.height_m];
  actual.forEach((v, i) => assert(Math.abs(v - want[i]) < 1e-4, `${object.id} mesh/collision extent ${i}`));
}
for (const object of spec.objects) {
  const v = built.layout.vehicles.find((v) => v.id === object.id)!;
  assert.equal(object.visible_from_s, object.keyframes[0].t_s);
  assert.equal(object.visible_to_s, object.keyframes.at(-1)!.t_s);
  assert(v, `${object.id}: engine dropped an observed object`);
  if (object.visible_from_s > 0) assert(v.poseAt(object.visible_from_s - 0.001).hidden);
  assert(!v.poseAt(object.visible_from_s).hidden);
  assert(!v.poseAt(object.visible_to_s).hidden);
  const observed = object.keyframes.filter((k) => k.src !== "edge-extrapolated");
  for (const k of object.keyframes.filter((k) => k.src === "edge-extrapolated")) {
    assert.equal(object.involvement, "background", "no crash-pair extrapolation");
    const endpoint = k.t_s < observed[0].t_s ? observed[0] : observed.at(-1)!;
    assert.equal(k.y_m, endpoint.y_m, "stay in endpoint lane");
    assert(k.sigma_m! >= (endpoint.sigma_m ?? 0));
  }
}

// Independent synthetic response checks; normals point from vehicle a into fixed object b.
const wall: StaticObject = { id: "synthetic-wall", kind: "barrier", label: "SYNTHETIC wall", footprint_m: [[-10, 1], [10, 1], [10, 2], [-10, 2]],
  height_m: 0.5, material: "concrete", friction: 0, restitution: 0.2, stiffness_n_per_m: 1e6, immovable: true, source: "inferred", sigma_m: 0.1, note: "SYNTHETIC" };
const staticWall = staticCollisionGeometry(wall);
const footprint = { radiusX: 0.5, radiusZ: 1 };
const hit = findFirstEllipseStaticContact((t) => ({ x: 0, z: 2 - t, yaw: 0 }), footprint, staticWall, 4)!;
assert(hit && Math.abs(hit.time - 2) < 1e-6, "swept static collision time");
assert(Math.abs(hit.normalX) < 1e-6 && Math.abs(hit.normalZ + 1) < 1e-6);
assert.equal(ellipseStaticContactAt({ x: 0, z: 5, yaw: 0 }, footprint, staticWall), null);
const normal = planNormalToScene(90);
assert(Math.abs(normal.x) < 1e-9 && normal.z === -1);
const body = { pose: { x: 0, z: 0, yaw: 0 }, velocityX: 0, velocityZ: -10, yawRate: 0, massKg: 1500, footprint };
const response = resolveEllipseStaticImpact(body, staticWall, normal)!;
assert(Math.abs(response[0].velocityZ - 2) < 1e-9, "static restitution");
assert.deepEqual(response[1], { velocityX: 0, velocityZ: 0, yawRate: 0 });
assert.equal(resolveEllipseStaticImpact({ ...body, velocityZ: 2 }, staticWall, normal), null);

if (existsSync(path + ".build.json")) {
  const meta = JSON.parse(readFileSync(path + ".build.json", "utf8"));
  for (const source of Object.values(meta.sources) as { path: string; sha256: string }[])
    assert.equal(createHash("sha256").update(readFileSync(source.path)).digest("hex"), source.sha256, `source changed: ${source.path}`);
  const all = JSON.parse(readFileSync(meta.sources.tracks_world.path, "utf8")).tracks;
  const cp = meta.sources.crash_pair ? JSON.parse(readFileSync(meta.sources.crash_pair.path, "utf8")) : {};
  const crashTracks = Object.entries(cp.vehicles ?? {}).map(([id, t]: any) => ({ ...t, id: t.id ?? id }));
  for (const track of [...all.filter((t: any) => !t.crash), ...crashTracks]) {
    const id = meta.source_track_to_spec_id[String(track.id)];
    if (!id) continue;
    const object = spec.objects.find((o) => o.id === id)!;
    for (const sample of track.samples) {
      if (sample.f < 0 || sample.f > 399) continue;
      const k = object.keyframes.find((k) => Math.abs(k.t_s - sample.f / 12.5) < 1e-6)!;
      assert(k, `lost source frame ${id}@${sample.f}`);
      assert(Math.abs(k.x_m - (meta.X_REF - sample.x)) <= 0.00051);
      assert(Math.abs(k.y_m - (sample.y - meta.Y_median)) <= 0.00051);
      assert.equal(k.src, sample.src);
      if (sample.sigma_m !== undefined) assert.equal(k.sigma_m, sample.sigma_m);
    }
  }
}
registerSceneSpec(built.scene.id, spec);
const kin = deriveSceneKinematics(built.scene)!;
assert(kin, "kinematics must derive");
assert.equal(kin.meta.static_objects?.length ?? 0, spec.static_objects?.length ?? 0);
assert.equal(kin.meta.contacts?.length ?? 0, spec.crash?.contacts.length ?? 0);
console.log(JSON.stringify({ result: "MEASURED ENGINE CHECK PASS", fixture: spec.title, vehicles: plan.vehicles.length,
  keyframes: spec.objects.reduce((n, o) => n + o.keyframes.length, 0), max_pose_error_m: worst, painted_lines: marks,
  static_objects: spec.static_objects?.length ?? 0, contacts: spec.crash?.contacts.length ?? 0, kinematics_rows: kin.frames.length,
  elapsed_ms: Math.round(performance.now() - start) }, null, 2));
