/**
 * Terminal chat against the mock scene, for working on the assistant before the app exists.
 *
 *   npm run chat                          # first usable provider
 *   npm run chat -- --provider codex
 *   npm run chat -- --provider claude --model haiku
 *   npm run chat -- --provider claude --model claude-opus-5-5 --effort low
 *   npm run chat -- --no-fast-path        # send everything to the LLM
 *   npm run chat -- "zoom in on the red toyota"   # one-shot
 *
 * Use --provider anthropic-api with ANTHROPIC_API_KEY set for the API fallback.
 */
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { MockSceneController } from "../mock/mock-scene";
import { checkAllProviders, pickDefaultProvider } from "../providers/health";
import type { ProviderKind } from "../providers/types";
import { AssistantSession } from "../session";

// Optional private .env (gitignored) with fallback keys, e.g. GEMINI_API_KEY.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    provider: { type: "string" },
    model: { type: "string" },
    effort: { type: "string" },
    "no-fast-path": { type: "boolean", default: false },
  },
});

let provider = values.provider as ProviderKind | undefined;
if (!provider) {
  const health = await checkAllProviders();
  provider = pickDefaultProvider(health) ?? undefined;
  if (!provider) {
    console.error("No provider is usable. Run `npm run providers` for details.");
    process.exit(1);
  }
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const ctl = new MockSceneController();
const session = await AssistantSession.create({
  controller: ctl,
  provider,
  model: values.model,
  effort: values.effort as "low" | "medium" | "high" | undefined,
  apiKey: process.env.ANTHROPIC_API_KEY,
  fastPath: !values["no-fast-path"],
  prompt: { incidentSummary: "Mock incident: a red Toyota Camry heading east brakes and strikes the side of a white Honda CR-V heading south, 4.0 s into 8 s of footage." },
});
console.log(dim(`provider: ${provider}${values.model ? ` (${values.model})` : ""} — type a command, Ctrl+C to quit`));

async function turn(text: string) {
  const t0 = performance.now();
  let firstTool: number | null = null;
  for await (const ev of session.send(text)) {
    switch (ev.type) {
      case "text":
        process.stdout.write(ev.delta);
        break;
      case "tool_call":
        firstTool ??= performance.now() - t0;
        process.stdout.write(dim(`\n  → ${ev.name} ${JSON.stringify(ev.input)}\n`));
        break;
      case "tool_result":
        process.stdout.write(dim(`  ${ev.ok ? "✓" : "✗"} ${ev.output.slice(0, 160)}\n`));
        break;
      case "error":
        process.stdout.write(`\n\x1b[31merror: ${ev.message}\x1b[0m`);
        break;
      case "done":
        break;
    }
  }
  const total = performance.now() - t0;
  console.log(dim(`\n  [${firstTool !== null ? `first tool ${Math.round(firstTool)} ms, ` : ""}total ${Math.round(total)} ms]`));
}

if (positionals.length) {
  await turn(positionals.join(" "));
  await session.close();
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
process.stdout.write("\n> ");
for await (const raw of rl) {
  const line = raw.trim();
  if (line) {
    if (!process.stdin.isTTY) console.log(line);
    await turn(line);
  }
  process.stdout.write("\n> ");
}
await session.close();
process.exit(0);
