import Anthropic from "@anthropic-ai/sdk";
import type { SceneController } from "../controller";
import { callTool, TOOLS, toolJsonSchema } from "../tools/registry";
import { EventQueue } from "./queue";
import type { AssistantEvent, ProviderAdapter } from "./types";

export interface AnthropicApiOptions {
  apiKey: string;
  systemPrompt: string;
  /** Tools run in-process against this controller (no MCP hop). */
  controller: SceneController;
  model?: string;
  /** "low" keeps voice commands snappy; raise for long explanations. */
  effort?: "low" | "medium" | "high";
}

const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 8;

/**
 * API-key fallback (requirements §5.6, §10: "the guaranteed path for the
 * demo"). A plain Messages API tool loop over the same tool registry the MCP
 * server uses. Conversation history is kept append-only across turns so the
 * prompt cache stays valid.
 *
 * Server-side refusal fallback is on (`fallbacks: "default"`); remove the
 * beta + field if you'd rather surface refusals as errors.
 */
export class AnthropicApiAdapter implements ProviderAdapter {
  readonly kind = "anthropic-api" as const;
  private client: Anthropic;
  private messages: Anthropic.Beta.BetaMessageParam[] = [];
  private abort: AbortController | null = null;
  private tools: Anthropic.Beta.BetaTool[];

  constructor(private opts: AnthropicApiOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.tools = TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toolJsonSchema(t) as Anthropic.Beta.BetaTool.InputSchema,
    }));
  }

  async start(): Promise<void> {}

  async *send(message: string): AsyncIterable<AssistantEvent> {
    if (this.abort) throw new Error("A turn is already running; wait for it or interrupt().");
    const q = new EventQueue<AssistantEvent>();
    this.abort = new AbortController();
    this.messages.push({ role: "user", content: message });
    void this.runTurn(q, this.abort.signal).finally(() => {
      this.abort = null;
      q.close();
    });
    yield* q;
  }

  private async runTurn(q: EventQueue<AssistantEvent>, signal: AbortSignal) {
    const started = Date.now();
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const stream = this.client.beta.messages.stream(
          {
            model: this.opts.model ?? DEFAULT_MODEL,
            max_tokens: 4096,
            system: this.opts.systemPrompt,
            cache_control: { type: "ephemeral" },
            output_config: { effort: this.opts.effort ?? "low" },
            tools: this.tools,
            messages: this.messages,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { signal },
        );
        stream.on("text", (delta) => q.push({ type: "text", delta }));
        const msg = await stream.finalMessage();
        this.messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });

        if (msg.stop_reason === "refusal") {
          q.push({ type: "error", message: "The model declined this request." });
          return;
        }
        if (msg.stop_reason === "pause_turn") continue;
        if (msg.stop_reason !== "tool_use") {
          q.push({ type: "done", durationMs: Date.now() - started });
          return;
        }

        const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        // Run sequentially: camera moves are order-dependent ("seek, then query").
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const use of uses) {
          q.push({ type: "tool_call", id: use.id, name: use.name, input: use.input });
          const res = await callTool(this.opts.controller, use.name, use.input);
          const output = res.ok ? JSON.stringify(res.result) : res.error;
          q.push({ type: "tool_result", id: use.id, name: use.name, ok: res.ok, output });
          results.push({ type: "tool_result", tool_use_id: use.id, content: output, ...(res.ok ? {} : { is_error: true }) });
        }
        // All results for one assistant turn go back in a single user message.
        this.messages.push({ role: "user", content: results });
      }
      q.push({ type: "error", message: "Stopped after too many tool calls in one turn." });
    } catch (err) {
      this.closeDanglingToolUses();
      if (signal.aborted) q.push({ type: "done", durationMs: Date.now() - started });
      else if (err instanceof Anthropic.AuthenticationError) q.push({ type: "error", message: "The Anthropic API key was rejected. Check it in settings." });
      else if (err instanceof Anthropic.RateLimitError) q.push({ type: "error", message: "Rate limited by the Anthropic API. Try again in a moment." });
      else if (err instanceof Anthropic.APIError) q.push({ type: "error", message: `Anthropic API error ${err.status ?? ""}: ${err.message}` });
      else q.push({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** After an abort mid-loop, answer any unanswered tool_use so the next request is valid. */
  private closeDanglingToolUses() {
    const last = this.messages.at(-1);
    if (last?.role !== "assistant" || !Array.isArray(last.content)) return;
    const ids = last.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : []));
    if (ids.length) {
      this.messages.push({
        role: "user",
        content: ids.map((id) => ({ type: "tool_result" as const, tool_use_id: id, content: "Interrupted by the user.", is_error: true })),
      });
    }
  }

  async interrupt(): Promise<void> {
    this.abort?.abort();
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    this.messages = [];
  }
}
