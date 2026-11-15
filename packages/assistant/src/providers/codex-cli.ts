import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_SERVER_NAME } from "../mcp/server";
import { EventQueue } from "./queue";
import { onJsonLines, resolveCli, spawnCli } from "./resolve-cli";
import type { AdapterOptions, AssistantEvent, ProviderAdapter } from "./types";

const TOKEN_ENV = "RECONSTRUCT_MCP_TOKEN";
/** TOML basic strings accept JSON string escapes, so JSON.stringify gives a valid TOML value. */
const toml = (s: string) => JSON.stringify(s);

/**
 * Codex CLI adapter: one `codex exec --json` per turn; later turns use
 * `codex exec resume <thread_id>` so the conversation carries over.
 *
 * Lock-down (flags verified with codex-cli 0.167):
 *   --ignore-user-config        skip ~/.codex/config.toml (the user's MCP servers, profiles); auth still works
 *   sandbox_mode="read-only"    and every tool feature that can touch the machine or web is disabled
 *   mcp_servers.reconstruct.*   our server, bearer token passed by env var name (never on the command line)
 *   developer_instructions      our system prompt
 *
 * The JSONL event handling follows Codex's documented `exec --json` schema
 * (thread.started, item.started/completed, turn.completed/failed). The
 * tool-call path has not been run end to end yet (the test account was rate
 * limited); check it in the day-one spike.
 */
export class CodexCliAdapter implements ProviderAdapter {
  readonly kind = "codex" as const;
  private dir: string | null = null;
  private child: ChildProcess | null = null;
  threadId: string | null = null;

  constructor(private opts: AdapterOptions) {}

  async start(): Promise<void> {
    if (!resolveCli("codex")) throw new Error("Codex CLI isn't installed (no `codex` on PATH).");
    this.dir ??= await mkdtemp(join(tmpdir(), "reconstruct-codex-"));
  }

  private args(): string[] {
    const common = [
      "--json",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "-c", `sandbox_mode="read-only"`,
      "-c", `approval_policy="never"`,
      "-c", `web_search="disabled"`,
      "-c", `mcp_servers.${MCP_SERVER_NAME}.url=${toml(this.opts.mcp.url)}`,
      "-c", `mcp_servers.${MCP_SERVER_NAME}.bearer_token_env_var=${toml(TOKEN_ENV)}`,
      "-c", `developer_instructions=${toml(this.opts.systemPrompt)}`,
      "-c", `model_reasoning_effort="${this.opts.effort ?? "low"}"`,
      ...["shell_tool", "unified_exec", "apps", "plugins", "browser_use", "computer_use", "image_generation", "multi_agent", "in_app_browser"].flatMap(
        (f) => ["--disable", f],
      ),
    ];
    if (this.opts.model) common.push("-m", this.opts.model);
    // Prompt comes from stdin ("-") so it never hits the command line.
    return this.threadId ? ["exec", "resume", ...common, this.threadId, "-"] : ["exec", ...common, "-"];
  }

  async *send(message: string): AsyncIterable<AssistantEvent> {
    await this.start();
    if (this.child) throw new Error("A turn is already running; wait for it or interrupt().");
    const cli = resolveCli("codex")!;
    const q = new EventQueue<AssistantEvent>();
    const tools = new Map<string, string>();
    const started = Date.now();

    const child = spawnCli(cli, this.args(), {
      cwd: this.dir!,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.opts.env, [TOKEN_ENV]: this.opts.mcp.token },
    });
    this.child = child;
    let stderr = "";
    let failed = false;
    child.stderr!.on("data", (d) => (stderr = (stderr + d).slice(-4000)));

    onJsonLines(child, (ev) => {
      switch (ev.type) {
        case "thread.started":
          this.threadId = ev.thread_id ?? this.threadId;
          break;
        case "item.started": {
          const it = ev.item;
          if (it?.type === "mcp_tool_call") {
            tools.set(it.id, it.tool);
            q.push({ type: "tool_call", id: it.id, name: it.tool, input: it.arguments });
          }
          break;
        }
        case "item.completed": {
          const it = ev.item;
          if (it?.type === "agent_message" && it.text) q.push({ type: "text", delta: it.text });
          else if (it?.type === "mcp_tool_call") {
            const ok = it.status !== "failed" && !it.error;
            const output = ok
              ? (it.result?.content ?? []).map((c: any) => (c.type === "text" ? c.text : "")).join("") || JSON.stringify(it.result ?? {})
              : String(it.error?.message ?? "Tool call failed.");
            q.push({ type: "tool_result", id: it.id, name: tools.get(it.id) ?? it.tool, ok, output });
          }
          break;
        }
        case "turn.failed":
        case "error":
          if (!failed) q.push({ type: "error", message: String(ev.error?.message ?? ev.message ?? "Codex reported an error.") });
          failed = true;
          break;
      }
    });

    child.on("error", (err) => {
      q.push({ type: "error", message: `Couldn't start Codex: ${err.message}` });
      q.close();
    });
    child.on("close", (code) => {
      this.child = null;
      if (!failed) {
        if (code === 0) q.push({ type: "done", sessionId: this.threadId ?? undefined, durationMs: Date.now() - started });
        else q.push({ type: "error", message: `Codex exited (code ${code}). ${stderr.trim().split("\n").slice(-3).join(" ")}`.trim() });
      }
      q.close();
    });

    child.stdin!.end(message);
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
