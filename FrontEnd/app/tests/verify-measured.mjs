// Full measured integration checks. No Electron launch, live model call or real DB connection.
// From FrontEnd/app: node tests/verify-measured.mjs
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const app = fileURLToPath(new URL("../", import.meta.url));
const root = path.resolve(app, "../..");
const assistant = path.join(root, "packages/assistant");
const tsx = path.join(assistant, "node_modules/.bin/tsx");
const python = path.join(root, ".venv/bin/python");
const incident = "electron/demo-incident/incident-spec.json";
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const checks = [
  ["Coordinate/static mapping", root, python, ["FrontEnd/app/electron/demo-incident/build-measured-spec.py", "--check"]],
  ["Real input/output integrity", root, python, ["FrontEnd/app/electron/demo-incident/measure/review/validate_measured.py"]],
  ...["spec-measured", "motion-observations", "playback-camera", "playback-visibility", "measured-clip", "kinematics-playback", "kinematics-sync"].map((name) =>
    [name, app, tsx, ["--tsconfig", "tsconfig.json", `tests/${name}.test.ts`]]),
  ["Demo upload/restore routing", app, "node", ["tests/gemini-demo-routing.test.mjs"]],
  ["Real production planner/schema", app, tsx, ["--tsconfig", "tsconfig.json", "electron/demo-incident/engine-check.mts", incident]],
  ["Real production geometry/kinematics", app, tsx, ["--tsconfig", "tsconfig.json", "electron/demo-incident/measure/review_spec/engine-check-measured.mts", incident]],
  ["Collision geometry", app, "node", ["tests/collision.test.mjs"]],
  ["Assistant typecheck", assistant, "npm", ["run", "typecheck"]],
  ["Assistant tests", assistant, "npm", ["test"]],
  ["Production build", app, "npm", ["run", "build"]],
];
const report = { generated: new Date().toISOString(), spec_sha256: sha(path.join(app, incident)),
  sidecar_sha256: sha(path.join(app, incident + ".build.json")), checks: [], passed: false,
  scope: "Real source data to spec, viewer pose functions, disposable Mongo and actual assistant controller, routing, geometry, schema and production build. Browser/source visual evidence is separate. No app restart, live model call or real database access." };
for (const [name, cwd, command, args] of checks) {
  const start = Date.now();
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const passed = result.status === 0 && !result.error;
  report.checks.push({ name, cwd: path.relative(root, cwd) || ".", command: [command, ...args], passed,
    exit_code: result.status, duration_ms: Date.now() - start, stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
  console.log(`${passed ? "PASS" : "FAIL"} ${name} (${Date.now() - start} ms)`);
  if (!passed) {
    console.error(result.stdout, result.stderr, result.error ?? "");
    break;
  }
}
report.passed = report.checks.length === checks.length && report.checks.every((check) => check.passed)
  && report.spec_sha256 === sha(path.join(app, incident));
writeFileSync(new URL("./final-verification.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
if (!report.passed) process.exitCode = 1;
