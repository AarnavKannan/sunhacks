import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onJsonLines, resolveCli, runCli, spawnCli } from "../../../packages/assistant/src/providers/resolve-cli";

export const VISION_MODEL = "gpt-6.1-terra";
export type VisionPart = { text?: string; fileData?: { fileUri: string }; videoMetadata?: { fps?: number; startOffset?: string; endOffset?: string; duration?: number } };

/** Structured output requires closed objects, including nested nullable objects. */
export function strictSchema(value: any): any {
  if (Array.isArray(value)) return value.map(strictSchema);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, v]) => [key, strictSchema(v)]));
  if (result.properties) {
    result.additionalProperties = false;
    result.required = Object.keys(result.properties);
  }
  return result;
}

/** Bound images per request while covering the entire requested interval. */
export function samplePlan(from: number, to: number, fps: number, views: number) {
  if (![from, to, fps, views].every(Number.isFinite) || from < 0 || to <= from || fps <= 0 || views < 1) throw new Error("Invalid video sampling interval.");
  const count = Math.min(Math.ceil((to - from) * fps), Math.max(4, Math.floor(160 / views)));
  const rate = count / (to - from);
  return { count, rate, times: Array.from({ length: count }, (_, i) => from + i / rate) };
}

export async function visionPreflight(): Promise<{ ok: true; available: string[] } | { ok: false; error: string }> {
  const cli = resolveCli("codex");
  if (!cli) return { ok: false, error: "Install Codex CLI and sign in with `codex login`." };
  const status = await runCli(cli, ["login", "status"]);
  if (status.code !== 0 || !/logged in using ChatGPT/i.test(status.stdout + status.stderr)) {
    return { ok: false, error: "Sign in with your ChatGPT subscription using `codex login`. Reconstruction requires ChatGPT auth." };
  }
  return { ok: true, available: [VISION_MODEL] };
}

function ffmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile(process.env.FFMPEG_PATH || "ffmpeg", args, { windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (error, _out, stderr) => {
      if (error) reject(new Error(`Video frame extraction failed: ${stderr.slice(-1000) || error.message}`));
      else resolve();
    });
  });
}

export function footageDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-i", path], { windowsHide: true, timeout: 15_000 }, (_error, _out, stderr) => {
      const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
      const seconds = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
      if (seconds > 0) resolve(seconds);
      else reject(new Error("Couldn't read the footage duration. Check the file and ffmpeg installation."));
    });
  });
}

export async function generateVision(parts: VisionPart[], schema: unknown, systemPrompt: string, onStatus?: (detail: string) => void) {
  const cli = resolveCli("codex");
  if (!cli) throw new Error("Codex CLI isn't installed. Install it and run `codex login`.");
  const dir = await mkdtemp(join(tmpdir(), "reconstruct-vision-"));
  try {
    const images: string[] = [];
    const prompt: string[] = [];
    const views = parts.filter((p) => p.fileData).length;
    for (const [index, part] of parts.entries()) {
      if (part.text) prompt.push(part.text);
      if (!part.fileData) continue;
      const meta = part.videoMetadata ?? {};
      const from = Number.parseFloat(meta.startOffset ?? "0");
      const to = Number.parseFloat(meta.endOffset ?? String(meta.duration));
      const plan = samplePlan(from, to, meta.fps ?? 2, views);
      onStatus?.(`Preparing ${plan.count} frames for ${VISION_MODEL} (${from.toFixed(1)}–${to.toFixed(1)} s)…`);
      const prefix = `view-${index}-`;
      await ffmpeg(["-hide_banner", "-loglevel", "error", "-y", "-ss", String(from), "-i", part.fileData.fileUri, "-t", String(to - from), "-vf",
        `fps=${plan.rate}:start_time=0:round=up,scale=768:432:force_original_aspect_ratio=decrease,pad=768:432:(ow-iw)/2:(oh-ih)/2,tile=2x2:nb_frames=4:padding=2:margin=2`,
        "-frames:v", String(Math.ceil(plan.count / 4)), join(dir, `${prefix}%03d.jpg`)]);
      const sheets = (await readdir(dir)).filter((name) => name.startsWith(prefix)).sort();
      if (!sheets.length) throw new Error("No frames could be extracted from the selected footage.");
      for (const [sheet, name] of sheets.entries()) {
        images.push(join(dir, name));
        prompt.push(`Image ${images.length}: frames in row-major order (top-left, top-right, bottom-left, bottom-right), source-video times ${plan.times.slice(sheet * 4, sheet * 4 + 4).map((t) => `${t.toFixed(3)} s`).join(", ")}. Any remaining cells are blank. Requested interval ${from}–${to} s; actual sampling ${plan.rate.toFixed(3)} fps. Use these absolute video timestamps, never sheet indices. Sampling can miss brief events; state uncertainty.`);
      }
    }
    const schemaPath = join(dir, "schema.json");
    const outputPath = join(dir, "answer.json");
    await writeFile(schemaPath, JSON.stringify(strictSchema(schema)));
    const args = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "-s", "read-only",
      "-m", VISION_MODEL, "-c", 'model_reasoning_effort="xhigh"', "-c", 'approval_policy="never"', "-c", 'web_search="disabled"',
      "-c", `developer_instructions=${JSON.stringify(systemPrompt)}`,
      ...["shell_tool", "unified_exec", "apps", "plugins", "browser_use", "computer_use", "image_generation", "multi_agent", "in_app_browser"].flatMap((feature) => ["--disable", feature]),
      "--output-schema", schemaPath, "-o", outputPath, ...images.flatMap((path) => ["-i", path]), "-"];
    // Keep the CLI's stored ChatGPT login; never inherit an API-key billing path.
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_ACCESS_TOKEN;
    delete env.CODEX_API_KEY;
    onStatus?.(`${VISION_MODEL} is reading ${images.length} frame sheets through your ChatGPT login (xhigh effort)…`);
    let usage: unknown;
    await new Promise<void>((resolve, reject) => {
      const child = spawnCli(cli, args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      let failure = "";
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 600_000);
      const heartbeat = setInterval(() => onStatus?.(`${VISION_MODEL} is still processing the frame sheets (xhigh effort)…`), 20_000);
      child.stderr!.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
      onJsonLines(child, (event) => {
        if (event.type === "turn.completed") usage = event.usage;
        if (event.type === "turn.failed" || event.type === "error") failure = event.error?.message ?? event.message ?? "Codex failed.";
      });
      const cleanup = () => { clearTimeout(timer); clearInterval(heartbeat); };
      child.on("error", (error) => { cleanup(); reject(error); });
      child.on("close", (code) => {
        cleanup();
        if (timedOut) reject(new Error("Codex vision timed out after 10 minutes. Try a shorter clip."));
        else if (code !== 0 || failure) reject(new Error(failure || `Codex exited (${code}): ${stderr.slice(-1500)}`));
        else resolve();
      });
      child.stdin!.on("error", () => {});
      child.stdin!.end(prompt.join("\n\n"));
    });
    return { json: JSON.parse(await readFile(outputPath, "utf8")) as unknown, usage: { model: VISION_MODEL, auth: "chatgpt", usage } };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
