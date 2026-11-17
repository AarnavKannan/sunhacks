import { Activity, ArrowUpRight, LockKeyhole, Mic, Orbit, Ruler, Sparkles, SplitSquareHorizontal } from "lucide-react";
import type { CSSProperties } from "react";

const speedSeries = [18.0, 17.3, 16.1, 14.5, 12.5, 10.4, 8.3, 6.2, 4.6, 3.9, 4.3];

function speedPath() {
  return speedSeries
    .map((speed, index) => {
      const x = 8 + (index / (speedSeries.length - 1)) * 224;
      const y = 88 - (speed / 20) * 68;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function sceneBento() {
  return (
    <article className="bento-card bento-scene" data-reveal>
      <div className="bento-head">
        <span className="bento-icon"><Orbit size={15} /></span>
        <span className="bento-eyebrow">4D RECONSTRUCTION</span>
      </div>
      <h3>Walk through the scene. Not past it.</h3>
      <p>
        A Gaussian-splat background plus per-vehicle objects. Orbit, pan, and zoom while the
        incident plays — the geometry never breaks.
      </p>

      <div className="bento-orbit" aria-hidden="true">
        <div className="orbit-ring orbit-ring-a" />
        <div className="orbit-ring orbit-ring-b" />
        <div className="orbit-ring orbit-ring-c" />
        <div className="orbit-floor" />
        <div className="orbit-object">
          <span className="orbit-car orbit-car-a" />
          <span className="orbit-car orbit-car-b" />
          <span className="orbit-car orbit-car-c" />
          <span className="orbit-pin" />
        </div>
        <span className="orbit-tag orbit-tag-a">v53</span>
        <span className="orbit-tag orbit-tag-b">v56</span>
        <span className="orbit-note">ORBIT · 360°</span>
      </div>

      <div className="bento-foot">
        <span>Background splat</span>
        <span>Per-vehicle splats</span>
        <span className="bento-link">Explore <ArrowUpRight size={12} /></span>
      </div>
    </article>
  );
}

function kinematicsBento() {
  return (
    <article className="bento-card bento-kinematics" data-reveal style={{ "--delay": "60ms" } as CSSProperties}>
      <div className="bento-head">
        <span className="bento-icon"><Activity size={15} /></span>
        <span className="bento-eyebrow">KINEMATICS</span>
      </div>
      <h3>Every frame has a number.</h3>
      <p>Position, velocity, acceleration, heading, and uncertainty — sampled and queryable.</p>

      <div className="kin-chart">
        <div className="kin-chart-head">
          <span><i className="legend-dot legend-dot-lime" /> v56 · speed</span>
          <span>km/h</span>
        </div>
        <svg viewBox="0 0 240 104" aria-label="v56 speed falling from 18.0 to 3.9 kilometres per hour across the impact window">
          <defs>
            <linearGradient id="kin-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#d8ff4f" stopOpacity=".28" />
              <stop offset="1" stopColor="#d8ff4f" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="kin-grid">
            <path d="M8 20h224M8 54h224M8 88h224" />
          </g>
          <path d={`${speedPath()} L232 88 L8 88 Z`} fill="url(#kin-area)" />
          <path d={speedPath()} className="kin-line" fill="none" />
          <line x1="52.8" y1="8" x2="52.8" y2="88" className="kin-impact" />
          <circle cx="52.8" cy="33.3" r="3.2" className="kin-dot" />
          <text x="60" y="20" className="kin-impact-label">IMPACT</text>
          <text x="8" y="16" className="kin-y-label">18.0</text>
          <text x="204" y="84" className="kin-y-label">3.9</text>
        </svg>
      </div>

      <div className="kin-footer">
        <span>pos</span>
        <span>quat</span>
        <span>vel</span>
        <span>acc</span>
        <span>heading</span>
        <span>σ</span>
      </div>
    </article>
  );
}

function assistantBento() {
  return (
    <article className="bento-card bento-assistant" data-reveal>
      <div className="bento-head">
        <span className="bento-icon"><Sparkles size={15} /></span>
        <span className="bento-eyebrow">SCENE ASSISTANT</span>
      </div>
      <h3>Ask in plain English. Get a measured answer.</h3>
      <div className="mini-chat">
        <div className="mini-bubble mini-user">Show me from above, then orbit 90° left.</div>
        <div className="mini-bubble mini-assistant">
          Camera moved to top view and orbited 90° left. The impact pair is centered.
        </div>
        <div className="mini-tools">
          <code>camera.set</code>
          <code>camera.orbit</code>
        </div>
      </div>
      <div className="mini-composer">
        <Mic size={13} />
        <span>Ask about this scene…</span>
        <kbd>SPACE</kbd>
      </div>
      <div className="bento-foot">
        <span>Claude Code</span>
        <span>Codex</span>
        <span>Gemini</span>
        <span className="bento-link">MCP <ArrowUpRight size={12} /></span>
      </div>
    </article>
  );
}

function syncBento() {
  return (
    <article className="bento-card bento-sync" data-reveal style={{ "--delay": "60ms" } as CSSProperties}>
      <div className="bento-head">
        <span className="bento-icon"><SplitSquareHorizontal size={15} /></span>
        <span className="bento-eyebrow">SOURCE SYNC</span>
      </div>
      <h3>Two views. One clock.</h3>
      <p>Play the original footage beside the reconstruction, locked to the same frame.</p>
      <div className="sync-visual">
        <div className="sync-pane">
          <img src="/media/crash-poster.jpg" alt="" aria-hidden="true" />
          <span>SOURCE</span>
        </div>
        <div className="sync-pane sync-pane-scene">
          <div className="sync-road" />
          <span>4D SCENE</span>
        </div>
        <div className="sync-playhead" />
        <div className="sync-time">T+21.76</div>
      </div>
      <div className="bento-foot">
        <span>Frame-accurate</span>
        <span>Multi-camera mosaic</span>
        <span className="bento-link">Sync <ArrowUpRight size={12} /></span>
      </div>
    </article>
  );
}

function measureBento() {
  return (
    <article className="bento-card bento-measure" data-reveal>
      <div className="bento-head">
        <span className="bento-icon"><Ruler size={15} /></span>
        <span className="bento-eyebrow">MEASURE &amp; MARK</span>
      </div>
      <h3>Measure it. Mark it. Export it.</h3>
      <p>Click two points for distance. Drop a marker. Render the camera path as video.</p>
      <div className="measure-visual" aria-hidden="true">
        <svg viewBox="0 0 280 110">
          <rect width="280" height="110" fill="#0b0f12" />
          <path d="M0 18h280M0 92h280" stroke="#ffffff" strokeOpacity=".06" />
          <path d="M16 96 96 22h88l80 74z" fill="#151a1f" />
          <path d="M24 96 102 28M256 96 178 28" stroke="#ffffff" strokeOpacity=".18" strokeDasharray="3 8" />
          <path d="M108 30h64l40 48H68z" fill="#11151a" />
          <path d="M122 44h36l22 28H98z" fill="#0b0f12" />
          <path d="M102 74 196 50" stroke="#d8ff4f" strokeOpacity=".8" strokeDasharray="3 3" />
          <circle cx="102" cy="74" r="4" fill="#d8ff4f" />
          <circle cx="196" cy="50" r="4" fill="#d8ff4f" />
          <rect x="120" y="51" width="58" height="18" rx="5" fill="#0a0d10" stroke="#d8ff4f" strokeOpacity=".3" />
          <text x="149" y="63.5" textAnchor="middle" fill="#d8ff4f" fontSize="9" fontFamily="monospace">34.2 m</text>
          <g transform="translate(224 32)">
            <path d="M0 14 7 0h6l-5 8h8z" fill="#ff6a3d" />
            <circle cx="9" cy="18" r="2.5" fill="#ff6a3d" />
          </g>
        </svg>
      </div>
      <div className="bento-foot">
        <span>Meters / feet</span>
        <span>Markers</span>
        <span className="bento-link">MP4 <ArrowUpRight size={12} /></span>
      </div>
    </article>
  );
}

function localBento() {
  return (
    <article className="bento-card bento-local" data-reveal style={{ "--delay": "60ms" } as CSSProperties}>
      <div className="bento-head">
        <span className="bento-icon"><LockKeyhole size={15} /></span>
        <span className="bento-eyebrow">LOCAL-FIRST</span>
      </div>
      <h3>Your evidence stays yours.</h3>
      <p>The desktop app reads scenes from your disk. No account, no background upload, no cloud lock-in.</p>
      <div className="local-visual" aria-hidden="true">
        <div className="local-lock-ring local-lock-ring-a" />
        <div className="local-lock-ring local-lock-ring-b" />
        <div className="local-lock-core"><LockKeyhole size={18} /></div>
        <span className="local-chip local-chip-a">source.mp4</span>
        <span className="local-chip local-chip-b">tracks.json</span>
        <span className="local-chip local-chip-c">reconstruction.ply</span>
      </div>
      <div className="bento-foot">
        <span>Local GPU</span>
        <span>Local export</span>
        <span className="bento-link">Private <ArrowUpRight size={12} /></span>
      </div>
    </article>
  );
}

export function Bento() {
  return (
    <section className="section-pad bento-section">
      <div className="container-x">
        <div className="section-head" data-reveal>
          <div className="section-kicker">
            <span className="section-index">02</span>
            <span>THE WORKBENCH</span>
            <span className="section-rule" />
          </div>
          <div className="section-head-copy">
            <h2>
              One incident.
              <span className="serif"> Every angle covered.</span>
            </h2>
            <p>
              Reconstruction, measurement, playback, and explanation live in the same window.
              No export-import shuffle between six tools.
            </p>
          </div>
        </div>

        <div className="bento-grid">
          {sceneBento()}
          {kinematicsBento()}
          {assistantBento()}
          {syncBento()}
          {measureBento()}
          {localBento()}
        </div>
      </div>
    </section>
  );
}
