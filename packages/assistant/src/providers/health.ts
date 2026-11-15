import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderHealth, ProviderKind } from "./types";
import { resolveCli, runCli } from "./resolve-cli";

/**
 * Detects which providers are installed and signed in, the way T3 Code does:
 * run `<cli> --version`, then the CLI's own auth-status command. We never read
 * or copy the user's credentials, only ask the CLI whether it has them.
 */

function firstLine(s: string): string {
  return s.trim().split(/\r?\n/)[0] ?? "";
}

export async function checkClaude(): Promise<ProviderHealth> {
  const cli = resolveCli("claude");
  if (!cli) return { kind: "claude", installed: false, auth: "unknown", usable: false, hint: "Install Claude Code: https://claude.com/claude-code" };
  const v = await runCli(cli, ["--version"]);
  const version = firstLine(v.stdout);
  // `claude auth status` prints JSON: { loggedIn, authMethod, subscriptionType, ... }
  const s = await runCli(cli, ["auth", "status"]);
  try {
    const j = JSON.parse(s.stdout);
    if (j.loggedIn) {
      const detail = [j.authMethod, j.subscriptionType && `(${j.subscriptionType})`].filter(Boolean).join(" ");
      return { kind: "claude", installed: true, version, auth: "authenticated", authDetail: detail || undefined, usable: true };
    }
    return { kind: "claude", installed: true, version, auth: "unauthenticated", usable: false, hint: "Run `claude auth login` in a terminal, then try again." };
  } catch {
    return { kind: "claude", installed: true, version, auth: "unknown", usable: true, hint: "Couldn't read `claude auth status`; it may still work." };
  }
}

export async function checkCodex(): Promise<ProviderHealth> {
  const cli = resolveCli("codex");
  if (!cli) return { kind: "codex", installed: false, auth: "unknown", usable: false, hint: "Install Codex CLI: npm i -g @openai/codex" };
  const v = await runCli(cli, ["--version"]);
  const version = firstLine(v.stdout).replace(/^codex-cli\s*/, "");
  // `codex login status` exits 0 with "Logged in using ChatGPT" / "Logged in using an API key".
  const s = await runCli(cli, ["login", "status"]);
  const out = (s.stdout + s.stderr).trim();
  if (s.code === 0 && /logged in/i.test(out)) {
    return { kind: "codex", installed: true, version, auth: "authenticated", authDetail: out.replace(/^logged in using\s*/i, "") || undefined, usable: true };
  }
  return { kind: "codex", installed: true, version, auth: "unauthenticated", usable: false, hint: "Run `codex login` in a terminal, then try again." };
}

export async function checkGemini(): Promise<ProviderHealth> {
  const cli = resolveCli("gemini");
  if (!cli) return { kind: "gemini", installed: false, auth: "unknown", usable: false, hint: "Install Gemini CLI: npm i -g @google/gemini-cli" };
  const v = await runCli(cli, ["--version"]);
  const version = firstLine(v.stdout);
  // Gemini CLI has no auth-status command. Signed-in Google accounts leave
  // ~/.gemini/oauth_creds.json. An API key doesn't count here: the CLI path is
  // for the user's Google login (the key is the separate "gemini-api" fallback).
  if (existsSync(join(homedir(), ".gemini", "oauth_creds.json"))) {
    return { kind: "gemini", installed: true, version, auth: "authenticated", authDetail: "Google account", usable: true };
  }
  return { kind: "gemini", installed: true, version, auth: "unauthenticated", usable: false, hint: "Run `gemini` once in a terminal and sign in with Google." };
}

export async function checkAnthropicApi(): Promise<ProviderHealth> {
  const has = Boolean(process.env.ANTHROPIC_API_KEY);
  return {
    kind: "anthropic-api",
    installed: true,
    auth: has ? "authenticated" : "unauthenticated",
    authDetail: has ? "ANTHROPIC_API_KEY" : undefined,
    usable: has,
    hint: has ? undefined : "Paste an Anthropic API key in settings (fallback when no CLI is signed in).",
  };
}

export function geminiApiKeyFromEnv(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

export async function checkGeminiApi(): Promise<ProviderHealth> {
  const has = Boolean(geminiApiKeyFromEnv());
  return {
    kind: "gemini-api",
    installed: true,
    auth: has ? "authenticated" : "unauthenticated",
    authDetail: has ? "GEMINI_API_KEY (fallback)" : undefined,
    usable: has,
    hint: has ? undefined : "Optional: set GEMINI_API_KEY as a last-resort fallback.",
  };
}

export async function checkAllProviders(): Promise<ProviderHealth[]> {
  return Promise.all([checkClaude(), checkCodex(), checkGemini(), checkGeminiApi(), checkAnthropicApi()]);
}

/**
 * Preference order when the user hasn't picked one. Subscription logins first
 * (Claude Code is the main provider); API keys only as a last resort.
 */
export const DEFAULT_PROVIDER_ORDER: ProviderKind[] = ["claude", "codex", "gemini", "gemini-api", "anthropic-api"];

export function pickDefaultProvider(health: ProviderHealth[], order = DEFAULT_PROVIDER_ORDER): ProviderKind | null {
  for (const kind of order) if (health.find((h) => h.kind === kind)?.usable) return kind;
  return null;
}
