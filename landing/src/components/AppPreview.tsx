import { Box, Layers, Mic, Pause, Play, RotateCcw, ScanLine, Sparkles, Volume2 } from "lucide-react";
import { useEffect, useRef } from "react";

/** Deterministic point cloud so the mock scene looks like a splat reconstruction, not random noise. */
const splats = Array.from({ length: 74 }, (_, index) => {
  const x = (index * 83.17 + 51) % 760;
  const y = 146 + ((index * 47.63) % 252);
  const spread = 1 + (index % 4) * 0.88;
  const tone = index % 5;
  return { x, y, r: spread, tone };
});

const toneClass = ["splat-a", "splat-b", "splat-c", "splat-d", "splat-e"];

function SceneCanvas() {
  return (
    <svg className="scene-canvas" viewBox="0 0 760 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="scene-bg" cx="52%" cy="34%" r="78%">
          <stop offset="0" stopColor="#1a242e" />
          <stop offset=".48" stopColor="#0d141b" />
          <stop offset="1" stopColor="#070a0d" />
        </radialGradient>
        <radialGradient id="horizon-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ff6a3d" stopOpacity=".4" />
          <stop offset=".55" stopColor="#ff6a3d" stopOpacity=".09" />
          <stop offset="1" stopColor="#ff6a3d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="road-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#181c21" />
          <stop offset="1" stopColor="#0c0f12" />
        </linearGradient>
        <linearGradient id="edge-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e7f8c5" stopOpacity=".05" />
          <stop offset="1" stopColor="#e7f8c5" stopOpacity=".8" />
        </linearGradient>
        <filter id="soft-glow">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id="splat-blur">
          <feGaussianBlur stdDeviation=".45" />
        </filter>
      </defs>

      <rect width="760" height="420" fill="url(#scene-bg)" />
      <ellipse cx="470" cy="146" rx="260" ry="98" fill="url(#horizon-glow)" />

      {/* Distant treeline / structures */}
      <path d="M0 146h68l20-14 28 14h60l18-9 30 9h75l22-18 28 18h72l16-11 31 11h92l20-7 17 7h97v12H0z" fill="#070b0f" opacity=".9" />
      <g fill="#ffcf8b" opacity=".38">
        <rect x="126" y="120" width="2" height="2" />
        <rect x="248" y="124" width="2" height="2" />
        <rect x="332" y="116" width="2" height="2" />
        <rect x="521" y="122" width="2" height="2" />
        <rect x="664" y="118" width="2" height="2" />
      </g>

      {/* Road surface */}
      <path d="M0 420 310 142h140L760 420z" fill="url(#road-fill)" />
      <path d="M0 420 310 142h21L153 420z" fill="#0b0e12" opacity=".8" />
      <path d="M760 420 450 142h-21l156 278z" fill="#0b0e12" opacity=".8" />

      {/* Median and shoulders */}
      <path d="M362 142h36l9 278h-54z" fill="#13171b" />
      <path d="M349 142h13l-9 278h-17z" fill="#2a2f35" opacity=".65" />
      <path d="M398 142h13l26 278h-17z" fill="#2a2f35" opacity=".65" />
      <path d="M354 142h50" stroke="#d8ff4f" strokeOpacity=".28" strokeWidth="1" />

      {/* Perspective lane lines */}
      <g stroke="#dbe8d0" strokeOpacity=".28" strokeWidth="1">
        <path d="M96 420 324 142" strokeDasharray="1 14" />
        <path d="M244 420 352 142" strokeDasharray="1 14" />
        <path d="M516 420 408 142" strokeDasharray="1 14" />
        <path d="M664 420 436 142" strokeDasharray="1 14" />
      </g>
      <g stroke="#dbe8d0" strokeOpacity=".1" strokeWidth=".7">
        <path d="M18 420 300 142" />
        <path d="M742 420 460 142" />
      </g>

      {/* Cross-road perspective rungs */}
      <g stroke="#ffffff" strokeOpacity=".05">
        <path d="M236 294h288" />
        <path d="M286 246h188" />
        <path d="M312 208h136" />
        <path d="M330 180h100" />
      </g>

      {/* Splat field */}
      <g filter="url(#splat-blur)">
        {splats.map((splat, index) => (
          <circle
            key={index}
            cx={splat.x}
            cy={splat.y}
            r={splat.r}
            className={toneClass[splat.tone]}
            opacity={0.15 + (index % 6) * 0.055}
          />
        ))}
      </g>

      {/* Trajectories */}
      <path
        d="M96 406C186 350 240 316 362 294c74-13 132-4 198 2"
        fill="none"
        stroke="#ff6a3d"
        strokeWidth="1.4"
        strokeDasharray="5 7"
        className="scene-track scene-track-a"
      />
      <path
        d="M678 404C604 352 534 322 452 300c-46-12-84-6-128 4"
        fill="none"
        stroke="#d8ff4f"
        strokeWidth="1.4"
        strokeDasharray="5 7"
        className="scene-track scene-track-b"
      />

      {/* Vehicles */}
      <g transform="translate(430 302) rotate(-7)">
        <rect x="-21" y="-11" width="42" height="22" rx="5" fill="#1f252c" stroke="#8d99a4" strokeOpacity=".5" />
        <rect x="-10" y="-8" width="18" height="16" rx="3" fill="#8296a7" opacity=".48" />
        <circle cx="15" cy="-9" r="2" fill="#ff5c35" />
      </g>
      <g transform="translate(478 312) rotate(9)">
        <rect x="-20" y="-10" width="40" height="20" rx="4" fill="#21262b" stroke="#b9c5cf" strokeOpacity=".55" />
        <rect x="-9" y="-7" width="16" height="14" rx="2" fill="#aebdc9" opacity=".35" />
        <circle cx="-14" cy="8" r="2" fill="#d8ff4f" />
      </g>
      <g transform="translate(374 244) rotate(-4)" opacity=".7">
        <rect x="-14" y="-7" width="28" height="14" rx="3" fill="#1a2027" stroke="#a2b0bc" strokeOpacity=".4" />
        <rect x="-7" y="-5" width="12" height="10" rx="2" fill="#9ba9b5" opacity=".3" />
      </g>

      {/* Impact annotation */}
      <g transform="translate(472 294)">
        <circle r="42" fill="none" stroke="#ff6a3d" strokeOpacity=".18" />
        <circle r="25" fill="none" stroke="#ff6a3d" strokeOpacity=".3" className="impact-pulse" />
        <circle r="10" fill="none" stroke="#ff8a63" strokeOpacity=".65" />
        <circle r="3" fill="#ff5c35" />
      </g>
      <path d="M472 294 548 222" stroke="#ff6a3d" strokeOpacity=".45" strokeDasharray="3 4" />
    </svg>
  );
}

const scenes = [
  { name: "Freeway · multi-vehicle", meta: "155 vehicles · 59.9 s", active: true },
  { name: "Arterial · eastbound", meta: "2 vehicles · 16 s" },
  { name: "Dusk roundabout", meta: "4 vehicles · 25 s" },
];

export function AppPreview() {
  const insetVideo = useRef<HTMLVideoElement>(null);

  // React can attach `autoplay` before the element is muted, which makes some
  // browsers reject playback. Start the decorative inset explicitly instead.
  useEffect(() => {
    const video = insetVideo.current;
    if (!video) return;
    video.muted = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
      return;
    }

    const play = () => void video.play().catch(() => {});
    if (video.readyState >= 2) {
      play();
    } else {
      video.addEventListener("loadeddata", play, { once: true });
    }
    return () => video.removeEventListener("loadeddata", play);
  }, []);

  return (
    <div className="app-window" role="img" aria-label="CRASHVZN desktop app reconstructing the reference incident at the moment of impact">
      <div className="app-titlebar">
        <div className="app-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="app-title">
          <span className="app-title-mark">CV</span>
          Incident demo
          <span className="app-title-slash">/</span>
          4D reconstruction
        </div>
        <div className="app-titlebar-right">
          <span className="app-status"><i /> LOCAL</span>
          <span className="app-status app-status-muted">MCP CONNECTED</span>
        </div>
      </div>

      <div className="app-body">
        <aside className="app-sidebar">
          <div className="app-side-label">Incident library</div>
          {scenes.map((scene) => (
            <div key={scene.name} className={`app-scene ${scene.active ? "is-active" : ""}`}>
              <span className={`app-scene-thumb ${scene.active ? "is-active" : ""}`} aria-hidden="true" />
              <span className="app-scene-copy">
                <strong>{scene.name}</strong>
                <small>{scene.meta}</small>
              </span>
            </div>
          ))}
          <div className="app-side-separator" />
          <div className="app-side-label">Evidence</div>
          <div className="app-file">
            <span className="app-file-chip">MP4</span>
            <span>mosaic.mp4</span>
          </div>
          <div className="app-file">
            <span className="app-file-chip">JSON</span>
            <span>tracks.json</span>
          </div>
          <div className="app-file">
            <span className="app-file-chip">PLY</span>
            <span>background.ply</span>
          </div>
          <div className="app-sidebar-footer">
            <span className="local-dot" />
            <div>
              <strong>Local workspace</strong>
              <span>Nothing leaves this device</span>
            </div>
          </div>
        </aside>

        <section className="app-viewport">
          <SceneCanvas />
          <div className="viewport-toolbar">
            <span className="viewport-crumb">Scenes</span>
            <span className="viewport-crumb-sep">/</span>
            <strong>Incident demo</strong>
            <span className="viewport-badge"><span /> REALTIME</span>
          </div>
          <div className="viewport-tools">
            <span className="view-tool is-active"><Box size={13} /></span>
            <span className="view-tool"><Layers size={13} /></span>
            <span className="view-tool"><ScanLine size={13} /></span>
          </div>

          <div className="impact-callout">
            <span className="impact-callout-dot" />
            <div>
              <span>IMPACT DETECTED</span>
              <strong>T+21.76 s</strong>
            </div>
            <span className="impact-callout-meta">2 vehicles</span>
          </div>

          <div className="vehicle-tag vehicle-tag-a"><i /> v53 <span>8.9 km/h</span></div>
          <div className="vehicle-tag vehicle-tag-b"><i /> v56 <span>16.1 km/h</span></div>

          <div className="source-inset">
            <video
              ref={insetVideo}
              src="/media/crash-inset.mp4#t=6"
              poster="/media/crash-poster.jpg"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              aria-hidden="true"
            />
            <span className="source-inset-label"><i /> SOURCE · CAM_BR</span>
            <span className="source-inset-scan" />
          </div>

          <div className="viewport-hint">
            <span>Drag to orbit</span>
            <span>Scroll to zoom</span>
            <span>Space to play</span>
          </div>
        </section>

        <aside className="app-inspector">
          <div className="inspector-heading">
            <span className="inspector-title"><Sparkles size={14} /> Scene assistant</span>
            <span className="inspector-badge">MCP</span>
          </div>

          <div className="chat-thread">
            <div className="chat-bubble chat-user">Take me to the impact.</div>
            <div className="chat-bubble chat-assistant">
              Seeking to <strong>21.76 s</strong> — the first impact event on carriageway B.
            </div>
            <div className="chat-tool">
              <span>timeline.seek</span>
              <code>&quot;impact&quot;</code>
            </div>
            <div className="chat-bubble chat-user">Who was involved?</div>
            <div className="chat-bubble chat-assistant">
              The impact event involves <strong>v53</strong> and <strong>v56</strong>, 6.6 m apart. Their measured paths are highlighted.
            </div>
            <div className="chat-tool">
              <span>kinematics.events</span>
              <code>{`{ t: 21.76 }`}</code>
            </div>
            <div className="chat-typing" aria-hidden="true"><i /><i /><i /></div>
          </div>

          <div className="chat-composer">
            <span>Ask the scene…</span>
            <span className="chat-composer-icon"><Mic size={13} /></span>
          </div>
          <div className="inspector-foot">
            <span className="provider-dot" /> Claude Code · connected
          </div>
        </aside>

        <div className="app-timeline">
          <div className="timeline-top">
            <div className="timeline-play"><Play size={14} fill="currentColor" /></div>
            <span className="timeline-time">T+00:21.76</span>
            <span className="timeline-total">/ 00:59.92</span>
            <div className="timeline-track">
              <span className="timeline-fill" />
              <span className="timeline-event timeline-event-a"><i />IMPACT</span>
              <span className="timeline-event timeline-event-b"><i />BRAKE</span>
              <span className="timeline-event timeline-event-c"><i />REST</span>
              <span className="timeline-handle" />
            </div>
            <div className="timeline-controls">
              <span><RotateCcw size={12} /> 1×</span>
              <span><Volume2 size={12} /></span>
              <span className="timeline-export">EXPORT</span>
            </div>
          </div>
          <div className="timeline-bottom">
            <span>749 frames</span>
            <span>12.5 fps</span>
            <span>160 m stretch</span>
            <span className="timeline-bottom-live"><Pause size={10} /> PLAYBACK READY</span>
          </div>
        </div>
      </div>
    </div>
  );
}
