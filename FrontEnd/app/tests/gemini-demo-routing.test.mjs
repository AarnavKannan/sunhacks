/** Exercises the real IPC routing with a temporary spec and an in-memory analysis/scene store. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(app, "../..");
const scratch = await mkdtemp(join(tmpdir(), "demo-routing-"));
try {
  const bundle = join(scratch, "gemini.cjs");
  await build({ entryPoints: [join(app, "electron/gemini.ts")], outfile: bundle, bundle: true, platform: "node", format: "cjs",
    loader: { ".md": "text" }, define: { __dirname: JSON.stringify(join(app, "electron")) }, logLevel: "silent" });
  const { registerGemini, loadDemoSpec, demoLabel } = createRequire(import.meta.url)(bundle);
  const specPath = join(scratch, "incident-spec.json");
  const spec = { prompt_version: "measured-a9-v2", title: "Routing fixture", duration_s: 32, road: { kind: "divided_highway" }, objects: [],
    static_objects: [{ id: "median-divider", immovable: true }], crash: { contacts: [{ a: "car", b: "median-divider", frame: 290, t_s: 23.2, impulse_ns: 1000 }] }, caveats: [] };
  await writeFile(specPath, JSON.stringify(spec));
  const handlers = new Map();
  const analyses = new Map();
  const scenes = new Map();
  const collections = { analyses, scenes };
  const db = { collection(name) {
    const docs = collections[name];
    assert.ok(docs, `unexpected collection ${name}`);
    return {
      async replaceOne({ _id }, value) { docs.set(_id, structuredClone({ ...value, _id })); },
      async findOne({ _id }) { return structuredClone(docs.get(_id) ?? null); },
      find() { return { sort() { return { async toArray() { return structuredClone([...docs.values()]); } }; } }; },
    };
  } };
  registerGemini({ ipcMain: { handle(name, callback) { handlers.set(name, callback); } }, getWindow: () => null, db: async () => db,
    cacheDir: join(scratch, "unused-crops"), demoSpecPath: specPath });
  const call = (name, ...args) => handlers.get(name)(null, ...args);
  const videoHashes = [];
  for (const [name, duration] of [["demo.mp4", 59.92], ["demo_32s.mp4", 32]]) {
    const path = join(root, name);
    videoHashes.push(createHash("sha256").update(await readFile(path)).digest("hex"));
    const out = await call("gemini:analyze", [path], { durations: [duration] });
    assert.equal(out.analysisId, "demo-a9-verified-v1");
    assert.equal(out.spec.duration_s, 32);
    assert.equal(out.models[0], "measured");
    assert.match(out.known.version, /^measured-a9-v2#[a-f0-9]{12}$/);
    assert.deepEqual(out.spec.static_objects, spec.static_objects);
    assert.deepEqual(out.spec.crash.contacts, spec.crash.contacts);
  }
  const id = "demo-a9-verified-v1";
  const oldVersion = analyses.get(id).spec_version;
  await call("gemini:save-scene", { sceneId: "saved-demo", analysisId: id, seed: 1, created: "2026-11-15", title: "Stale title", report: { stale: true } });
  // Historical general-vision analyses of allowlisted footage also follow the regenerated spec.
  analyses.set("old-live-analysis", { ...structuredClone(analyses.get(id)), _id: "old-live-analysis", spec_version: "obsolete",
    videos: [{ name: "crash-camera", sha256: "cropped-hash", tile: { sourceSha: videoHashes[0] } }] });
  await call("gemini:save-scene", { sceneId: "legacy-demo", analysisId: "old-live-analysis", seed: 2, created: "2026-11-15", title: "Old vision scene" });
  // Change content while preserving prompt_version: content hashing must invalidate it anyway.
  spec.title = "Regenerated fixture";
  spec.crash.contacts[0].impulse_ns = 2000;
  await writeFile(specPath, JSON.stringify(spec));
  const restored = await call("gemini:list-scenes");
  assert.equal(restored.length, 2);
  for (const scene of restored) {
    assert.equal(scene.spec.title, "Regenerated fixture");
    assert.equal(scene.title, scene.spec.title);
    assert.equal(scene.report, undefined);
    assert.equal(scene.spec.crash.contacts[0].impulse_ns, 2000);
    assert.notEqual(analyses.get(scene.analysisId).spec_version, oldVersion);
    assert.equal(analyses.get(scene.analysisId).models.precise, "measured");
  }
  const reupload = await call("gemini:analyze", [join(root, "demo_32s.mp4")], { durations: [32] });
  assert.equal(reupload.spec.title, spec.title);
  assert.notEqual(reupload.known.version, oldVersion);
  assert.equal((await loadDemoSpec(specPath)).version, reupload.known.version);
  assert.equal(demoLabel("hand-verified-measured-v1"), "measured");
  assert.equal(demoLabel("hand-verified-a9-v1"), "hand-annotated");
  await writeFile(specPath, "invalid JSON");
  await assert.rejects(loadDemoSpec(specPath), /Couldn't read/);
  console.log(`Demo routing passed: both file hashes, measured label, upload and saved/legacy reload, contacts/statics, and same-prompt content invalidation.\n${videoHashes.join("\n")}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
