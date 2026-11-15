import { describe, expect, it } from "vitest";
import { matchEntities } from "../src/entity-match";
import { MockSceneController, MOCK_FPS } from "../src/mock/mock-scene";
import { callTool } from "../src/tools/registry";
import { buildSystemPrompt } from "../src/prompt/system-prompt";

const run = async (ctl: MockSceneController, name: string, args: unknown) => {
  const r = await callTool(ctl, name, args);
  if (!r.ok) throw new Error(r.error);
  return r.result as any;
};

describe("query_contacts", () => {
  it("returns vehicle-vehicle and vehicle-static contacts, the divider and the frame grid", async () => {
    const out = await run(new MockSceneController(), "query_contacts", {});
    expect(out.contacts.map((c: any) => c.kind).sort()).toEqual(["vehicle-static", "vehicle-vehicle"]);
    expect(out.static_objects[0]).toMatchObject({ id: "median-divider", immovable: true });
    expect(out.frame_grid).toMatchObject({ fps: 12.5, source: "video" });
    for (const c of out.contacts) {
      expect(Math.hypot(...c.normal)).toBeCloseTo(1, 6);
      c.impulse.forEach((v: number, i: number) => expect(v).toBeCloseTo(c.impulse_ns * c.normal[i], 6));
      expect(c.t_s).toBeCloseTo(c.frame / MOCK_FPS, 8);
      expect(c.normal[0]).toBeCloseTo(Math.cos(c.normal_deg_plan * Math.PI / 180), 8);
      expect(c.normal[2]).toBeCloseTo(-Math.sin(c.normal_deg_plan * Math.PI / 180), 8);
      for (const d of c.derived) {
        const sign = d.entity_id === c.a ? -1 : 1;
        expect(d.along_normal_ns).toBeCloseTo(sign * d.impulse.reduce((sum: number, v: number, i: number) => sum + v * c.normal[i], 0), 8);
      }
    }
  });

  it("requires an open incident", async () => {
    const r = await callTool(new MockSceneController({ open: false }), "query_contacts", {});
    expect(r.ok).toBe(false);
  });

  it("is listed in the system prompt", () => {
    expect(buildSystemPrompt()).toContain("query_contacts");
  });
});

describe("static objects", () => {
  it("has zero velocity and acceleration and a constant position at every time", async () => {
    const ctl = new MockSceneController();
    const r = await run(ctl, "kinematics_series", { entity_id: "median-divider", from_s: 0, to_s: 8, step_s: 1, fields: ["position", "velocity", "acceleration", "forces"] });
    expect(r.samples.length).toBeGreaterThan(5);
    for (const s of r.samples) {
      expect(s.entity_kind).toBe("static");
      expect(s.src).toBe("static");
      expect(s.position.value).toEqual(r.samples[0].position.value);
      expect(s.velocity.value).toEqual([0, 0, 0]);
      expect(s.acceleration.value).toBe(0);
      expect(s.forces.net.vector).toEqual([0, 0, 0]);
      expect(s.forces.model).toMatch(/immovable/);
    }
  });

  it("is a valid target for measure_distance and cannot be followed", async () => {
    const ctl = new MockSceneController();
    const m = await run(ctl, "measure_distance", { a: "median-divider", b: [0, 0, 0], t_s: 1 });
    expect(m.distance.m).toBeCloseTo(3.6, 1);
    expect((await callTool(ctl, "camera_follow", { entity_id: "median-divider" })).ok).toBe(false);
  });

  it("matches 'the divider', 'median', 'barrier', 'hedge' and 'bushes'", async () => {
    const ctl = new MockSceneController();
    const ents = (await ctl.describe()).entities;
    for (const q of ["the divider", "the median", "barrier", "hedge", "bushes", "median divider"]) {
      expect(matchEntities(ents, q)[0]?.id).toBe("median-divider");
    }
    expect(matchEntities(ents, "the toyota")[0]?.id).toBe("v1");
  });
});

describe("frame time references", () => {
  it("converts {frame} to t = frame / 12.5", async () => {
    const ctl = new MockSceneController();
    const k = await run(ctl, "kinematics_query", { entity_id: "v1", frame: 50, fields: ["speed"] });
    expect(k.t_s).toBe(4);
    expect(k.frame).toBe(50);
    const tl = await run(ctl, "timeline_seek", { frame: 25 });
    expect(tl).toMatchObject({ t_s: 2, frame: 25, fps: 12.5 });
  });

  it("rejects frame together with t_s", async () => {
    expect((await callTool(new MockSceneController(), "kinematics_query", { entity_id: "v1", frame: 5, t_s: 1 })).ok).toBe(false);
  });

  it("reports contact_with after contact", async () => {
    const k = await run(new MockSceneController(), "kinematics_query", { entity_id: "v2", frame: 60, fields: ["speed"] });
    expect(k.contact_with.sort()).toEqual(["median-divider", "v1"]);
  });

  it("rejects fractional and out-of-range source frames", async () => {
    const ctl = new MockSceneController();
    for (const frame of [-1, 0.5, 100, 101]) {
      expect((await callTool(ctl, "kinematics_query", { entity_id: "v1", frame })).ok).toBe(false);
    }
  });

  it("uses a half-open source frame grid and labels between-frame estimates", async () => {
    const ctl = new MockSceneController();
    const tl = await run(ctl, "timeline_seek", { t_s: 8 });
    expect(tl.frame).toBe(99);
    const sample = await run(ctl, "kinematics_query", { entity_id: "v1", t_s: 1.01, fields: ["position"] });
    expect(sample.src).toBe("interpolated");
  });

  it("rejects frame plus an event offset", async () => {
    expect((await callTool(new MockSceneController(), "timeline_seek", { frame: 50, offset_s: -1 })).ok).toBe(false);
  });
});

describe("motion vectors", () => {
  it("exposes the full acceleration vector consistently with net force", async () => {
    const k = await run(new MockSceneController(), "kinematics_query", { entity_id: "v1", frame: 40, fields: ["acceleration", "forces", "heading"] });
    expect(k.acceleration.vector).toHaveLength(3);
    k.acceleration.vector.forEach((a: number, i: number) => expect(k.forces.net.vector[i]).toBeCloseTo(a * k.forces.mass_kg, 1));
    expect(k.body_heading.unit).toBe("deg");
  });

  it("keeps static acceleration vectors zero", async () => {
    const k = await run(new MockSceneController(), "kinematics_query", { entity_id: "median-divider", frame: 99, fields: ["acceleration", "forces"] });
    expect(k.acceleration.vector.every((v: number) => v === 0)).toBe(true);
    expect(k.forces.mass_kg).toBe(0);
  });
});
