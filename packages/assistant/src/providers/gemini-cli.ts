import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_SERVER_NAME } from "../mcp/server";
import { TOOLS } from "../tools/registry";
import { EventQueue } from "./queue";
import { onJsonLines, resolveCli, spawnCli } from "./resolve-cli";
import type { AdapterOptions, AssistantEvent, ProviderAdapter } from "./types";

/**
 * Gemini CLI adapter: one `gemini -p ... --output-format stream-json` per turn,
 * run from a temp project dir whose `.gemini/settings.json` registers our MCP
 * server and allows only its tools. The system prompt is delivered through
 * GEMINI_SYSTEM_MD, which replaces Gemini CLI's built-in prompt.
 *
 * UNVERIFIED: Gemini CLI isn't installed on the dev machine this was written
 * on. Settings keys and stream-json event names follow the Gemini CLI docs;
 * run `npm run chat -- --provider gemini` once it's installed and fix up.
 */
export class GeminiCliAdapter implements ProviderAdapter {
  readonly kind = "gemini" as const;
  private dir: string | null = null;
  private child: ChildProcess | null = null;
  private turns = 0;

  constructor(private opts: AdapterOptions) {}

  async start(): Promise<void> {
    if (this.dir) return;
    if (!resolveCli("gemini")) throw new Error("Gemini CLI isn't installed (no `gemini` on PATH).");
    this.dir = await mkdtemp(join(tmpdir(), "reconstruct-gemini-"));
    await mkdir(join(this.dir, ".gemini"));
    const settings = {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          httpUrl: this.opts.mcp.url,
          headers: { Authorization: `Bearer ${this.opts.mcp.token}` },
          trust: true,
          includeTools: TOOLS.map((t) => t.name),
        },
      },
      tools: { core: [] as string[] }, // no built-in shell/file/web tools
      mcp: { allowed: [MCP_SERVER_NAME] },
      telemetry: { enabled: false },
    };
    await writeFile(join(this.dir, ".gemini", "settings.json"), JSON.stringify(settings, null, 2), { mode: 0o600 });
    await writeFile(join(this.dir, "system.md"), this.opts.systemPrompt);
  }

  async *send(message: string): AsyncIterable<AssistantEvent> {
    await this.start();
    if (this.child) throw new Error("A turn is already running; wait for it or interrupt().");
    const cli = resolveCli("gemini")!;
    const q = new EventQueue<AssistantEvent>();
    const args = ["-p", message, "--output-format", "stream-json", "--approval-mode", "yolo"];
    if (this.turns > 0) args.push("--resume", "latest");
    if (this.opts.model) args.push("-m", this.opts.model);

    // Use the user's Google login, not an API key that happens to be in the environment.
    const env: NodeJS.ProcessEnv = { ...process.env, ...this.opts.env, GEMINI_SYSTEM_MD: join(this.dir!, "system.md") };
    delete env.GEMINI_API_KEY;
    delete env.GOOGLE_API_KEY;
    const child = spawnCli(cli, args, { cwd: this.dir!, stdio: ["ignore", "pipe", "pipe"], env });
    this.child = child;
    let stderr = "";
    let ended = false;
    child.stderr!.on("data", (d) => (stderr = (stderr + d).slice(-4000)));

    onJsonLines(child, (ev) => {
      switch (ev.type) {
        case "message":
          if (ev.role === "assistant" && ev.content) q.push({ type: "text", delta: String(ev.content) });
          break;
        case "tool_use":
          q.push({ type: "tool_call", id: ev.tool_id, name: String(ev.tool_name).replace(/^.*__/, ""), input: ev.parameters });
          break;
        case "tool_result":
          q.push({ type: "tool_result", id: ev.tool_id, ok: ev.status !== "error", output: String(ev.output ?? ev.error?.message ?? "") });
          break;
        case "error":
          q.push({ type: "error", message: String(ev.message ?? "Gemini reported an error.") });
          ended = true;
          break;
        case "result":
          if (ev.status === "error") q.push({ type: "error", message: String(ev.error?.message ?? "Gemini reported an error.") });
          else q.push({ type: "done", durationMs: ev.stats?.duration_ms });
          ended = true;
          break;
      }
    });

    child.on("error", (err) => {
      q.push({ type: "error", message: `Couldn't start Gemini CLI: ${err.message}` });
      q.close();
    });
    child.on("close", (code) => {
      this.child = null;
      this.turns++;
      if (!ended) {
        q.push(code === 0 ? { type: "done" } : { type: "error", message: `Gemini CLI exited (code ${code}). ${stderr.trim().split("\n").slice(-3).join(" ")}`.trim() });
      }
      q.close();
    });

    yield* q;
  }

  async interrupt(): Promise<void> {
    this.child?.kill();
  }

  async stop(): Promise<void> {
    this.child?.kill();
    this.child = null;
    if (this.dir) await rm(this.dir, { recursive: true, force: true }).catch(() => {});
    this.dir = null;
  }
}
