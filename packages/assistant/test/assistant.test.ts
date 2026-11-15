import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchEntities } from "../src/entity-match";
import { buildSystemPrompt } from "../src/prompt/system-prompt";
import { matchFastPath } from "../src/fastpath";
import { startMcpServer, type RunningMcpServer } from "../src/mcp/server";
import { MOCK_ENTITIES, MockSceneController } from "../src/mock/mock-scene";
import { callTool, TOOLS, toolJsonSchema } from "../src/tools/registry";

describe("fast path", () => {
  it.each([
    ["pause", "timeline_pause", {}],
    ["Play.", "timeline_play", {}],
    ["okay zoom in", "camera_zoom", { factor: 2 }],
    ["zoom out a bit", "camera_zoom", { factor: 0.77 }],
    ["orbit 90 degrees to the left", "camera_orbit", { yaw_deg: -90, pitch_deg: 0 }],
    ["rotate ninety degrees right", "camera_orbit", { yaw_deg: 90, pitch_deg: 0 }],
    ["show me from above", "camera_preset", { preset: "top" }],
    ["jump to the moment of impact", "timeline_seek", { event: "crash_start" }],
    ["go to the end of the crash", "timeline_seek", { event: "crash_end" }],
    ["go back 2 seconds", "timeline_seek", { relative_s: -2 }],
    ["show me the original footage", "ui_toggle", { target: "source_video", visible: true }],
    ["pan left", "camera_move", { right_m: -5 }],
    ["move forward 10 meters", "camera_move", { forward_m: 10 }],
    ["look up 15 degrees", "camera_rotate", { yaw_deg: 0, pitch_deg: 15 }],
    ["4x speed", "timeline_play", { speed: 4 }],
    ["trimetric view", "camera_preset", { preset: "trimetric" }],
    ["show me the rear view", "camera_preset", { preset: "back" }],
    ["bottom view", "camera_preset", { preset: "bottom" }],
    ["isometric", "camera_preset", { preset: "iso" }],
    ["step back 2 seconds", "timeline_seek", { relative_s: -2 }],
    ["half speed", "timeline_play", { speed: 0.5 }],
    ["reset view", "camera_reset", {}],
  ])("%s → %s", (text, tool, args) => {
    const m = matchFastPath(text);
    expect(m?.tool).toBe(tool);
    expect(m?.args).toEqual(args);
  });

  it.each([
    "zoom in on the red toyota",
    "jump to impact and tell me how fast it was going",
    "how fast was the honda going?",
    "orbit around the honda",
    "was the toyota at fault",
    "go back",
    "back",
    "show me the toyota's point of view",
    "how fast was it going 3 seconds before the crash",
  ])("sends %s to the LLM", (text) => {
    expect(matchFastPath(text)).toBeNull();
  });
});

describe("entity matching", () => {
  it("ranks the red toyota first", () => {
    expect(matchEntities(MOCK_ENTITIES, "the red Toyota")[0]).toMatchObject({ id: "v1", score: 1 });
  });
  it("matches aliases and types", () => {
    expect(matchEntities(MOCK_ENTITIES, "the SUV")[0]?.id).toBe("v2");
    expect(matchEntities(MOCK_ENTITIES, "car 2")[0]?.id).toBe("v2");
  });
  it("returns nothing for unknown vehicles", () => {
    expect(matchEntities(MOCK_ENTITIES, "blue truck")).toEqual([]);
  });
});

describe("tool registry", () => {
  it("uses API-safe tool names and produces object schemas", () => {
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(toolJsonSchema(t).type).toBe("object");
    }
  });

  it("rejects bad args with a readable error instead of throwing", async () => {
    const ctl = new MockSceneController();
    const r = await callTool(ctl, "timeline_seek", { t_s: 1, event: "crash_start" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exactly one/);
    expect(ctl.log).toHaveLength(0);
  });

  it("pans to a vehicle without turning or zooming", async () => {
    const ctl = new MockSceneController();
    const before = await ctl.describe();
    const r = await callTool(ctl, "camera_pan_to", { entity_id: "v2" });
    expect(r.ok).toBe(true);
    const cam = (r as any).result;
    const offset = (c: { position: number[]; target: number[] }) => c.position.map((v, i) => v - c.target[i]!);
    offset(cam).forEach((v: number, i: number) => expect(v).toBeCloseTo(offset(before.camera)[i]!, 1));
    const bad = await callTool(ctl, "camera_pan_to", { entity_id: "v1", point: [0, 0, 0] });
    expect(bad.ok).toBe(false);
  });

  it("turns controller errors into tool errors", async () => {
    const r = await callTool(new MockSceneController(), "camera_focus", { entity_id: "v9" });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/No vehicle with id "v9"/) });
  });

  it("answers speed at the crash from the controller with units and uncertainty", async () => {
    const ctl = new MockSceneController();
    await callTool(ctl, "timeline_seek", { event: "crash_start" });
    const r = await callTool(ctl, "kinematics_query", { entity_id: "v1" });
    expect(r.ok && (r.result as any).speed.mph).toMatchObject({ unit: "mph", sigma: expect.any(Number) });
  });

  it("reads kinematics relative to the crash without moving the playhead", async () => {
    const ctl = new MockSceneController();
    const r = await callTool(ctl, "kinematics_query", { entity_id: "v1", event: "crash_start", offset_s: -3, fields: ["speed", "heading", "forces", "velocity"] });
    expect(r.ok).toBe(true);
    const k = (r as any).result;
    expect(k).toMatchObject({ t_s: 1, t_rel_crash_s: -3, phase: "before_crash", heading: { compass: "east" } });
    expect(k.speed.mps.value).toBe(17);
    expect(k.velocity.value[0]).toBeCloseTo(17);
    expect(k.forces.net.magnitude.value).toBe(0);
    expect(ctl.timeline.t_s).toBe(0);
  });

  it("rejects offset_s without an event", async () => {
    const r = await callTool(new MockSceneController(), "kinematics_query", { entity_id: "v1", offset_s: -3 });
    expect(r.ok).toBe(false);
  });

  it("reports crash forces: speeds either side of contact, delta-v, impulse, closing speed", async () => {
    const r = await callTool(new MockSceneController(), "crash_forces", {});
    expect(r.ok).toBe(true);
    const out = (r as { result: any }).result;
    const toyota = out.vehicles.find((v: any) => v.entity_id === "v1");
    // Toyota: 17 m/s braking at 4 m/s² from 2.6 s reaches the crash at 11.4 m/s, heading east.
    expect(toyota.before.speed.mps.value).toBeCloseTo(11.4, 0);
    expect(toyota.before.heading_compass).toBe("east");
    // The crash slows it, so the change in velocity points back west.
    expect(toyota.delta_v.magnitude.mps.value).toBeGreaterThan(0);
    expect(toyota.impulse.direction_compass).toBe("west");
    expect(toyota.average_force.pulse_s).toBe(0.1);
    expect(out.closing_speed.mps.value).toBeCloseTo(Math.hypot(11.4, 11), 0);
    expect(out.caveats.length).toBeGreaterThan(0);
  });

  it("system prompt covers Gemini reconstructions, precision tiers and forces over time", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("crash_forces");
    expect(prompt).toContain("background");
    expect(prompt).toMatch(/Forces over time/);
    expect(prompt).not.toMatch(/doesn't separate air drag or friction/);
  });

  it("samples a series across the crash period", async () => {
    const r = await callTool(new MockSceneController(), "kinematics_series", { entity_id: "v1", from_s: 3, to_s: 5, step_s: 0.5, fields: ["speed", "acceleration"] });
    expect(r.ok).toBe(true);
    const samples = (r as any).result.samples;
    expect(samples.map((s: any) => s.phase)).toEqual(["before_crash", "before_crash", "during_crash", "during_crash", "after_crash"]);
    expect(samples.at(-1).speed.mps.value).toBe(0);
  });

  it("supports every standard view and rejects a plane view", async () => {
    const ctl = new MockSceneController();
    for (const preset of ["front", "back", "left", "right", "top", "bottom", "iso", "dimetric", "trimetric"]) {
      expect((await callTool(ctl, "camera_preset", { preset })).ok).toBe(true);
    }
    expect((await callTool(ctl, "camera_preset", { preset: "normal" })).ok).toBe(false);
    const back = (await callTool(ctl, "camera_preset", { preset: "back" })) as any;
    expect(back.result.position[2]).toBeLessThan(back.result.target[2]); // north of target (-z)
  });

  it("stops the camera at the scene boundary", async () => {
    const ctl = new MockSceneController();
    const r = await callTool(ctl, "camera_move", { up_m: 500 });
    expect(r.ok && (r.result as any).clamped).toBe(true);
    expect(ctl.camera.position[1]).toBe(45);
  });

  it("enters a vehicle's point of view looking along its heading", async () => {
    const ctl = new MockSceneController();
    const r = await callTool(ctl, "camera_pov", { entity_id: "v2" });
    const cam = (r as any).result;
    expect(cam.pov).toBe("v2");
    expect(cam.target[2]).toBeGreaterThan(cam.position[2]); // Honda heads south (+z)
  });

  it("requires an open incident and can open one from the library", async () => {
    const ctl = new MockSceneController({ open: false });
    const r = await callTool(ctl, "scene_describe", {});
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/No incident is open/) });
    const lib = await callTool(ctl, "library_list", {});
    const id = (lib as any).result.folders[0].incidents[0].id;
    expect((await callTool(ctl, "incident_open", { incident_id: id })).ok).toBe(true);
    expect((await callTool(ctl, "scene_describe", {})).ok).toBe(true);
  });
});

describe("MCP server", () => {
  let server: RunningMcpServer;
  const ctl = new MockSceneController();
  beforeAll(async () => {
    server = await startMcpServer({ controller: ctl });
  });
  afterAll(() => server.close());

  it("binds to loopback", () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it("rejects requests without the bearer token", async () => {
    const res = await fetch(server.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    const wrong = await fetch(server.url, { method: "POST", headers: { Authorization: "Bearer nope" }, body: "{}" });
    expect(wrong.status).toBe(401);
  });

  it("lists and calls tools over streamable HTTP", async () => {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: `Bearer ${server.token}` } } }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());

    const res = await client.callTool({ name: "camera_orbit", arguments: { yaw_deg: -90 } });
    expect(res.isError).toBeFalsy();
    expect(ctl.log.at(-1)).toEqual({ method: "orbit", args: [-90, 0] });

    const bad = await client.callTool({ name: "camera_focus", arguments: { entity_id: "v9" } });
    expect(bad.isError).toBe(true);
    await client.close();
  });
});
