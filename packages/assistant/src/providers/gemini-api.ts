import type { SceneController } from "../controller";
import { callTool, TOOLS, toolJsonSchema } from "../tools/registry";
import { EventQueue } from "./queue";
import type { AssistantEvent, ProviderAdapter } from "./types";

export interface GeminiApiOptions {
  apiKey: string;
  systemPrompt: string;
  /** Tools run in-process against this controller (no MCP hop). */
  controller: SceneController;
  model?: string;
}

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_TOOL_ROUNDS = 8;

type Part = {
  text?: string;
  thought?: boolean;
  functionCall?: { id?: string; name: string; args?: unknown };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
  [k: string]: unknown; // thoughtSignature etc. must round-trip untouched
};
type Content = { role: "user" | "model"; parts: Part[] };

/**
 * Last-resort fallback: Gemini API key (requirements §5.6). Only used when no
 * CLI login is usable. Claude Code on the user's own subscription is the main
 * provider.
 *
 * Plain REST (generateContent) so it adds no dependency. Model turns are
 * appended verbatim so Gemini 3's thought signatures on function calls round-trip.
 *
 * UNTESTED on purpose (owner's call); typechecked only.
 */
export class GeminiApiAdapter implements ProviderAdapter {
  readonly kind = "gemini-api" as const;
  private contents: Content[] = [];
  private abort: AbortController | null = null;
  private readonly functionDeclarations = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: toolJsonSchema(t),
  }));

  constructor(private opts: GeminiApiOptions) {}

  async start(): Promise<void> {}

  async *send(message: string): AsyncIterable<AssistantEvent> {
    if (this.abort) throw new Error("A turn is already running; wait for it or interrupt().");
    const q = new EventQueue<AssistantEvent>();
    this.abort = new AbortController();
    this.contents.push({ role: "user", parts: [{ text: message }] });
    void this.runTurn(q, this.abort.signal).finally(() => {
      this.abort = null;
      q.close();
    });
    yield* q;
  }

  private async generate(signal: AbortSignal): Promise<Content> {
    const model = this.opts.model ?? DEFAULT_MODEL;
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.opts.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: this.opts.systemPrompt }] },
        contents: this.contents,
        tools: [{ functionDeclarations: this.functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: "low" } },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Gemini rate-limited this key or its quota is used up. Try again shortly.");
      if (res.status === 401 || res.status === 403) throw new Error("Google rejected the Gemini API key.");
      throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data: any = await res.json();
    const cand = data.candidates?.[0];
    if (!cand?.content?.parts) {
      const why = data.promptFeedback?.blockReason ?? cand?.finishReason ?? "no content";
      throw new Error(`Gemini returned no answer (${why}).`);
    }
    return { role: "model", parts: cand.content.parts as Part[] };
  }

  private async runTurn(q: EventQueue<AssistantEvent>, signal: AbortSignal) {
    const started = Date.now();
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const turn = await this.generate(signal);
        this.contents.push(turn);

        for (const p of turn.parts) if (p.text && !p.thought) q.push({ type: "text", delta: p.text });
        const calls = turn.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
        if (calls.length === 0) {
          q.push({ type: "done", durationMs: Date.now() - started });
          return;
        }

        const responses: Part[] = [];
        for (const [i, call] of calls.entries()) {
          const id = call.id ?? `gemini-${round}-${i}`;
          q.push({ type: "tool_call", id, name: call.name, input: call.args ?? {} });
          const r = await callTool(this.opts.controller, call.name, call.args ?? {});
          const output = r.ok ? JSON.stringify(r.result) : r.error;
          q.push({ type: "tool_result", id, name: call.name, ok: r.ok, output });
          responses.push({
            functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: r.ok ? { result: r.result } : { error: r.error } },
          });
        }
        this.contents.push({ role: "user", parts: responses });
      }
      q.push({ type: "error", message: "Stopped after too many tool calls in one turn." });
    } catch (err) {
      this.closeDanglingCalls();
      if (signal.aborted) q.push({ type: "done", durationMs: Date.now() - started });
      else q.push({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** After an abort mid-loop, answer pending function calls so the next request is valid. */
  private closeDanglingCalls() {
    const last = this.contents.at(-1);
    if (last?.role !== "model") return;
    const calls = last.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (calls.length) {
      this.contents.push({
        role: "user",
        parts: calls.map((c) => ({ functionResponse: { ...(c.id ? { id: c.id } : {}), name: c.name, response: { error: "Interrupted by the user." } } })),
      });
    }
  }

  async interrupt(): Promise<void> {
    this.abort?.abort();
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    this.contents = [];
  }
}
