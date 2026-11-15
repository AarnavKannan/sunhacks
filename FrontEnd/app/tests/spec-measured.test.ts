import assert from "node:assert/strict";
import { sanitizeSpec, SAMPLE_SOURCES } from "../src/gemini/spec";

const raw = {
  duration_s: 32,
  road: {
    kind: "divided_highway",
    lanes_each_way: 6,
    lane_lines_forward_m: [4.2, 7.84, 11.31, 14.96, 18.73, 22.02, 25.04],
    lane_lines_backward_m: [0.4, 4.1, 7.8, 11.5],
  },
  objects: [{
    id: "Yellow Car", category: "sedan", color_name: "yellow", length_m: 4.7, width_m: 1.82, mass_kg: 1500,
    visible_from_s: 0, visible_to_s: 31.92,
    keyframes: SAMPLE_SOURCES.map((src, index) => ({
      t_s: index * .08, x_m: index, y_m: -5, heading_deg: index * 3, speed_mps: 12.5, src, sigma_m: .1 + index * .2,
    })),
    forces: [{ t_s: .16, fx_n: -3000, fy_n: 500, cause: "impact", note: "inferred from measured motion" }],
    rest: { x_m: 4, y_m: -5, heading_deg: 12 },
  }],
  static_objects: [{
    id: "Median Divider", kind: "median_divider", label: "Median verge", footprint_m: [[0, 0], [0, 2], [20, 2], [20, 0]],
    height_m: .15, material: "snow_covered_grass_verge", friction: .35, restitution: .05,
    stiffness_n_per_m: 300000, immovable: true, source: "measured", sigma_m: .1, note: "height is inferred",
  }],
  crash: {
    start_s: .16, end_s: .32, participants: ["Yellow Car", "Median Divider"],
    contacts: [{ a: "Yellow Car", b: "Median Divider", t_s: .16, x_m: 2, y_m: 0, normal_deg: 90,
      kind: "vehicle-static", frame: 2, impulse_ns: 1000, source: "inferred", sigma_s: .08, note: "verge entry" }],
  },
};

const spec = sanitizeSpec(raw);
assert.deepEqual(spec.road.lane_lines_forward_m, raw.road.lane_lines_forward_m);
assert.equal(spec.road.lanes_each_way, 6);
assert.deepEqual(spec.road.lane_lines_backward_m, raw.road.lane_lines_backward_m);
assert.deepEqual(spec.objects[0].keyframes.map((k) => [k.src, k.sigma_m]), raw.objects[0].keyframes.map((k) => [k.src, k.sigma_m]));
assert.deepEqual(spec.objects[0].forces, raw.objects[0].forces);
assert.deepEqual(spec.objects[0].rest, raw.objects[0].rest);
assert.deepEqual(spec.crash!.participants, ["yellow-car"]);
assert.equal(spec.static_objects![0].id, "median-divider");
assert.equal(spec.static_objects![0].immovable, true);
assert.equal(spec.crash!.contacts[0].b, "median-divider");
assert.equal(spec.crash!.contacts[0].kind, "vehicle-static");
assert.equal(spec.crash!.contacts[0].frame, 2);
assert.equal(spec.crash!.contacts[0].impulse_ns, 1000);
assert.equal(spec.crash!.contacts[0].source, "inferred");
assert.equal(spec.crash!.contacts[0].sigma_s, .08);
assert.equal(spec.crash!.contacts[0].note, "verge entry");
const polygon = spec.static_objects![0].footprint_m;
const twiceArea = polygon.reduce((area, p, i) => {
  const q = polygon[(i + 1) % polygon.length];
  return area + p[0] * q[1] - q[0] * p[1];
}, 0);
assert.ok(twiceArea > 0, "normalized static footprint must remain counter-clockwise");

const roundtrip = sanitizeSpec(spec);
assert.deepEqual(roundtrip.objects, spec.objects);
assert.deepEqual(roundtrip.static_objects, spec.static_objects);
assert.deepEqual(roundtrip.crash, spec.crash);
const secondPass = sanitizeSpec(raw, { contacts: raw.crash.contacts });
assert.deepEqual(secondPass.crash!.contacts, spec.crash!.contacts);

const invalid = sanitizeSpec({ ...raw, road: { lane_lines_forward_m: [4, 3, 5] }, static_objects: [
  { ...raw.static_objects[0], footprint_m: [[0, 0], [1, 0], [2, 0]] },
] });
assert.equal(invalid.road.lane_lines_forward_m, undefined);
assert.equal(invalid.static_objects, undefined);
assert.equal(invalid.crash!.contacts.length, 0, "invalid geometry must not remain a contact target");
console.log("Measured sanitizer: lane geometry, sample provenance, static contacts and round-trip preserved; invalid geometry rejected.");
