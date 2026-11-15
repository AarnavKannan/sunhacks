import { ArrowUpRight, Command, Mic, Sparkles, Volume2 } from "lucide-react";
import { useState } from "react";

type Prompt = {
  id: string;
  short: string;
  prompt: string;
  answer: string;
  tool: string;
  meta: string;
};

const prompts: Prompt[] = [
  {
    id: "impact",
    short: "Take me to impact",
    prompt: "Take me to the moment of impact.",
    answer:
      "Seeking to 21.76 s — the first impact event on carriageway B. The source camera and the reconstructed scene are now locked at T+0.",
    tool: 'timeline.seek("impact")',
    meta: "manifest.impact_time_s · 21.76",
  },
  {
    id: "speed",
    short: "How fast was v56?",
    prompt: "How fast was v56 moving at impact?",
    answer:
      "At T+0, v56 is measured at 16.1 km/h (±2.7). Its speed falls to 3.9 km/h within the next 0.56 s — a hard deceleration through the collision.",
    tool: "kinematics.sample({ entity: \"v56\", t: 21.76 })",
    meta: "speed_mps 4.47 · σ 0.75",
  },
  {
    id: "camera",
    short: "Show me from above",
    prompt: "Show me from above, then orbit 90° left.",
    answer:
      "Camera moved to top view and orbited 90° left. The impact pair is centered and both measured paths remain visible.",
    tool: 'camera.set("top") · camera.orbit(90, "left")',
    meta: "view-only · reconstruction untouched",
  },
  {
    id: "export",
    short: "Export this angle",
    prompt: "Export this angle as a video.",
    answer:
      "Rendering the current camera path across 0–59.92 s at 1080p. The MP4 will be saved to your machine when it finishes.",
    tool: "export.video({ range: \"full\", resolution: \"1080p\" })",
    meta: "local render · no upload",
  },
];

export function AssistantSection() {
  const [active, setActive] = useState(prompts[0]);

  return (
    <section className="section-pad assistant-section" id="assistant">
      <div className="container-x">
        <div className="assistant-panel" data-reveal>
          <div className="assistant-copy">
            <div className="section-kicker">
              <span className="section-index">05</span>
              <span>THE SCENE ASSISTANT</span>
              <span className="section-rule" />
            </div>
            <h2>
              The fastest way into a 3D scene
              <span className="serif"> is to ask.</span>
            </h2>
            <p>
              A local MCP server gives your LLM read-only eyes on the reconstruction. It can move
              the camera, query kinematics, and explain what it found — but it can never rewrite
              the evidence.
            </p>
            <p className="assistant-copy-small">
              Use the CLI you already pay for. CRASHVZN connects to Claude Code, Codex, or Gemini —
              or works without an assistant at all.
            </p>

            <div className="provider-row">
              <span><Command size={13} /> Claude Code</span>
              <span><Command size={13} /> Codex</span>
              <span><Command size={13} /> Gemini</span>
            </div>

            <div className="voice-note">
              <span className="voice-note-icon"><Mic size={15} /></span>
              <div>
                <strong>Push to talk, too.</strong>
                <span>Local speech-to-text feeds the same tool loop. No audio leaves the machine.</span>
              </div>
              <Volume2 size={15} className="voice-note-wave" />
            </div>
          </div>

          <div className="assistant-demo">
            <div className="assistant-demo-bar">
              <span className="assistant-demo-title"><Sparkles size={14} /> Scene assistant</span>
              <span className="assistant-demo-status"><i /> MCP · local</span>
            </div>

            <div className="assistant-demo-thread">
              <div className="demo-user-bubble" key={`user-${active.id}`}>
                {active.prompt}
              </div>

              <div className="demo-assistant-row" key={`answer-${active.id}`}>
                <span className="demo-avatar"><Sparkles size={13} /></span>
                <div className="demo-answer">
                  <p>{active.answer}</p>
                  <div className="demo-tool">
                    <span>tool call</span>
                    <code>{active.tool}</code>
                  </div>
                  <span className="demo-meta">{active.meta}</span>
                </div>
              </div>
            </div>

            <div className="assistant-prompts">
              <span>TRY A PROMPT</span>
              <div>
                {prompts.map((prompt) => (
                  <button
                    type="button"
                    key={prompt.id}
                    className={prompt.id === active.id ? "is-active" : ""}
                    onClick={() => setActive(prompt)}
                  >
                    {prompt.short}
                  </button>
                ))}
              </div>
            </div>

            <div className="assistant-composer">
              <span>Ask anything about this scene…</span>
              <span className="assistant-composer-actions">
                <kbd>⌘ K</kbd>
                <span className="assistant-composer-mic"><Mic size={14} /></span>
                <span className="assistant-composer-send"><ArrowUpRight size={14} /></span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
