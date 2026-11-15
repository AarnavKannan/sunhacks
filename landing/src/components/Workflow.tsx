import { ArrowRight, Film, FolderSearch, MessagesSquare, Video } from "lucide-react";
import type { CSSProperties } from "react";

const steps = [
  {
    number: "01",
    icon: Film,
    title: "Stage the footage",
    copy: "Drop in one camera or a full mosaic. Files are hashed and copied into a local incident workspace.",
    detail: "MP4 · MOV · MKV",
  },
  {
    number: "02",
    icon: FolderSearch,
    title: "Build the scene",
    copy: "The pipeline reconstructs the background, fits vehicle splats, and solves per-frame kinematics.",
    detail: "OpenSplat · Kalman + RTS",
  },
  {
    number: "03",
    icon: MessagesSquare,
    title: "Interrogate the moment",
    copy: "Orbit the scene, select a vehicle, scrub the clock, and ask the assistant for the measured answer.",
    detail: "MCP tools · chat or voice",
  },
  {
    number: "04",
    icon: Video,
    title: "Take the answer with you",
    copy: "Render the current camera path and timeline as an MP4. Annotate, measure, and share the view.",
    detail: "1080p export",
  },
];

export function Workflow() {
  return (
    <section className="section-pad workflow-section" id="workflow">
      <div className="container-x">
        <div className="section-head" data-reveal>
          <div className="section-kicker">
            <span className="section-index">04</span>
            <span>THE WORKFLOW</span>
            <span className="section-rule" />
          </div>
          <div className="section-head-copy">
            <h2>
              From raw footage
              <span className="serif"> to a room you can stand in.</span>
            </h2>
            <p>
              The heavy reconstruction happens once. After that, the desktop app is a live
              workspace for the scene — not a folder of renders.
            </p>
          </div>
        </div>

        <div className="workflow-grid">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <article className="workflow-step" key={step.number} data-reveal style={{ "--delay": `${index * 70}ms` } as CSSProperties}>
                <div className="workflow-step-head">
                  <span className="workflow-number">{step.number}</span>
                  <span className="workflow-icon"><Icon size={17} /></span>
                </div>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
                <div className="workflow-detail">
                  <span>{step.detail}</span>
                  {index < steps.length - 1 && <ArrowRight size={14} className="workflow-arrow" />}
                </div>
              </article>
            );
          })}
        </div>

        <div className="workflow-terminal" data-reveal>
          <div className="terminal-bar">
            <span className="terminal-dots"><i /><i /><i /></span>
            <span>reconstruct — pipeline</span>
            <span className="terminal-chip">REFERENCE BUILD</span>
          </div>
          <div className="terminal-body">
            <div className="terminal-line"><span className="terminal-prompt">$</span>reconstruct build</div>
            <div className="terminal-line terminal-muted">reading demo.mp4 · 960 × 610 · 12.5 fps</div>
            <div className="terminal-line terminal-ok">✓ 155 vehicle tracks · 5,355 samples</div>
            <div className="terminal-line terminal-ok">✓ impact detected · 21.76 s · v53 + v56</div>
            <div className="terminal-line terminal-ok">✓ scene package · 155 tracks · 1 impact</div>
            <div className="terminal-line"><span className="terminal-prompt">$</span><span className="terminal-caret" /></div>
          </div>
          <div className="terminal-aside">
            <span>ONE PACKAGE</span>
            <strong>tracks.json</strong>
            <strong>events.json</strong>
            <strong>manifest.json</strong>
            <strong>vehicles/*.ply</strong>
            <strong>sources/mosaic.mp4</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
