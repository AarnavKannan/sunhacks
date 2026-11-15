# @reconstruct/assistant

Role 4: the assistant layer. Lets the user drive the app by chat or voice using their own Claude Code, Codex or Gemini CLI login (or an Anthropic API key as a fallback). The model controls the app only through our MCP tools.

```
chat/voice panel ──▶ AssistantSession.send(text)
                       ├─ fast path (regex, <1 ms) ─────────────┐
                       └─ provider adapter                       │
                           ├─ claude -p (stream-json, long-lived)│
                           ├─ codex exec --json (per turn)       ├─▶ SceneController ─▶ app state (Zustand)
                           ├─ gemini -p (per turn)               │     (person 3 implements)
                           │     └─▶ MCP server 127.0.0.1+token ─┤
                           └─ Anthropic API (tools in-process) ──┘
```

## Try it

```sh
npm install
npm run providers                 # which CLIs are installed and signed in
npm run chat                      # REPL against a mock two-car scene
npm run chat -- --provider claude --model haiku "zoom in on the red toyota"
npm test
```

## Integrating with the app (person 3)

1. Implement `SceneController` (`src/controller.ts`) on top of the Zustand store. Its header lists the conventions the prompt promises users: camera moves clamp to the scene box and report `clamped`, work while playing, and scene calls fail with "No incident is open." on the home screen. World frame: meters, +x east, +y up, −z north, origin at the crash point. Functions are async so the main process can forward them to the renderer over IPC. `createIpcSceneController(invoke)` builds the proxy for you.
2. In the Electron main process:
   ```ts
   const health = await checkAllProviders();          // show in settings
   const session = await AssistantSession.create({
     controller, provider: pickDefaultProvider(health)!,
   });
   for await (const ev of session.send(text)) webContents.send("assistant:event", ev);
   ```
3. Render `SessionEvent`s: `text` deltas, `tool_call`/`tool_result` as small chips ("Orbiting…"), `error`, `done`.

`MockSceneController` (`src/mock/mock-scene.ts`) is a working reference implementation.

## Files

| File | What it is |
|---|---|
| `src/tools/registry.ts` | The 25 tools (requirements §7 plus `/ux-features.md`): library and Back, exact camera moves (degrees and meters), POV, crash-relative timeline seeks, per-frame kinematics and series, overlays including the source video. One definition serves MCP and the API adapters. Names use `_` not `.` (API name rules). |
| `src/mcp/server.ts` | Streamable HTTP MCP server on `127.0.0.1`, random port, per-session bearer token, stateless. |
| `src/prompt/system-prompt.ts` | The system prompt: plain language, numbers only from tools, units + uncertainty, crash as a period (before = before `crash_start`), camera conventions and scene bounds, POV caveat, no fault/liability opinions, read-only data. |
| `src/fastpath.ts` | Instant handling for "pause", "zoom in", "orbit 90 left", "jump to impact", etc. Anything naming a vehicle or asking a question goes to the LLM. |
| `src/providers/health.ts` | T3 Code-style detection: `claude auth status`, `codex login status`, Gemini creds file, `ANTHROPIC_API_KEY`. Never reads credentials. |
| `src/providers/*-cli.ts` | One adapter per CLI, each locked to our tools only (see the header comment in each file for the exact flags). |
| `src/providers/anthropic-api.ts` | API-key fallback: Messages API tool loop, `claude-opus-5-5` at low effort, server-side refusal fallback on. |
| `src/providers/resolve-cli.ts` | Finds CLIs on PATH and runs Windows npm `.cmd` shims through node directly, so prompts aren't mangled by `cmd.exe`. |

## Status

| Provider | Status |
|---|---|
| Claude Code 2.1.x | Verified end to end: the full demo script, multi-turn, guardrails. Only our tools are exposed. About 1.6 s to the first tool call and 3.5 s per simple command (Pro plan, default model). |
| Codex CLI 0.167 | Flags and MCP config parse and a thread starts. The tool-call event parsing is untested because the test account hit its usage limit. |
| Gemini CLI | Written from the docs. Not installed on the dev machine yet, so not run. |
| Gemini API key | Last-resort fallback, `gemini-3.1-flash-lite`, plain REST. Typechecked, deliberately not run. The key goes in the gitignored `packages/assistant/.env` as `GEMINI_API_KEY`. |
| Anthropic API | Typechecked; needs an `ANTHROPIC_API_KEY` to run. Not in use. |

Order when nothing is picked: `claude` → `codex` → `gemini` → `gemini-api` → `anthropic-api`. Claude Code on the user's own login is the main provider. The CLI adapters remove API-key environment variables before they start, so a key in `.env` never changes which account a CLI bills.

Still to do for role 4: push-to-talk STT sidecar, the AWS S3/EventBridge/SNS setup, and an `ANTHROPIC_API_KEY` settings field in the app.
