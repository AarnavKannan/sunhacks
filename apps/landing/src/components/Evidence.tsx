import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

const IMPACT = 21.76;

const v53 = [
  [21.12, 10.5], [21.2, 10.3], [21.28, 10.1], [21.36, 9.8], [21.44, 9.6], [21.52, 9.4],
  [21.6, 9.2], [21.68, 9.0], [21.76, 8.9], [21.84, 8.8], [21.92, 8.7], [22.0, 8.7],
  [22.08, 8.6], [22.16, 8.6], [22.24, 8.6], [22.32, 8.6], [22.4, 8.6], [22.48, 8.6],
  [22.56, 8.7], [22.64, 8.7], [22.72, 8.7], [22.8, 8.7], [22.88, 8.8], [22.96, 8.8],
  [23.04, 8.8], [23.12, 8.9], [23.2, 8.9], [23.28, 8.9], [23.36, 8.9], [23.44, 9.0],
  [23.52, 9.0], [23.6, 9.0],
] as const;

const v56 = [
  [21.6, 18.0], [21.68, 17.3], [21.76, 16.1], [21.84, 14.5], [21.92, 12.5], [22.0, 10.4],
  [22.08, 8.3], [22.16, 6.2], [22.24, 4.6], [22.32, 3.9], [22.4, 4.3], [22.48, 5.4],
  [22.56, 6.7], [22.64, 7.9], [22.72, 9.1], [22.8, 10.2], [22.88, 11.2], [22.96, 12.1],
  [23.04, 12.9], [23.12, 13.7], [23.2, 14.4], [23.28, 15.2], [23.36, 15.9], [23.44, 16.6],
  [23.52, 17.3], [23.6, 18.1],
] as const;

const events = [
  { t: 21.04, label: "v54 at rest", type: "rest" },
  { t: IMPACT, label: "impact · v53 + v56", type: "impact" },
  { t: 22.4, label: "v51 braking", type: "brake" },
];

function valueAt(series: readonly (readonly [number, number])[], time: number) {
  if (time < series[0][0] || time > series[series.length - 1][0]) return null;
  let closest = series[0];
  for (const sample of series) {
    if (Math.abs(sample[0] - time) < Math.abs(closest[0] - time)) closest = sample;
  }
  return closest[1];
}

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00.00";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
}

function relativeClock(time: number) {
  const delta = time - IMPACT;
  return `T${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)} s`;
}

function chartPath(series: readonly (readonly [number, number])[]) {
  return series
    .map(([time, speed], index) => {
      const x = 10 + ((time - 21.1) / 2.5) * 248;
      const y = 92 - (speed / 20) * 72;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function EvidencePlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(IMPACT);
  const [duration, setDuration] = useState(59.92);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) setCurrentTime(video.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  };

  const seek = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(duration, time));
    video.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const seekBy = (delta: number) => seek((videoRef.current?.currentTime ?? 0) + delta);

  const setPlaybackSpeed = () => {
    const next = speed === 1 ? 0.5 : speed === 0.5 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  const onScrub = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    seek(((event.clientX - rect.left) / rect.width) * duration);
  };

  const v53Speed = valueAt(v53, currentTime);
  const v56Speed = valueAt(v56, currentTime);
  const cursorX = 10 + ((currentTime - 21.1) / 2.5) * 248;
  const progress = `${(currentTime / duration) * 100}%`;

  return (
    <div className="evidence-widget" data-reveal>
      <div className="video-shell">
        <video
          ref={videoRef}
          className="evidence-video"
          src="/media/crash-demo.mp4"
          poster="/media/crash-poster.jpg"
          preload="metadata"
          playsInline
          muted
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            setDuration(video.duration || 59.92);
            video.currentTime = IMPACT;
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onClick={toggle}
        />

        <div className="video-grid-lines" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <span className="video-corner video-corner-tl">CAM_TL</span>
        <span className="video-corner video-corner-tr">CAM_TR</span>
        <span className="video-corner video-corner-bl">CAM_BL</span>
        <span className="video-corner video-corner-br">CAM_BR</span>

        <div className="video-hud">
          <div className="video-hud-left">
            <span className="video-live"><i /> SOURCE EVIDENCE</span>
            <strong>Freeway · carriageway B</strong>
          </div>
          <div className="video-hud-right">
            <span>{relativeClock(currentTime)}</span>
            <strong>{formatClock(currentTime)}</strong>
          </div>
        </div>

        {!playing && (
          <button type="button" className="video-big-play" onClick={toggle} aria-label="Play evidence video">
            <Play size={24} fill="currentColor" />
            <span>Play the reconstruction</span>
          </button>
        )}

        <div className="video-controls">
          <button type="button" className="video-control" onClick={() => seekBy(-1)} aria-label="Back one second">
            <SkipBack size={16} />
          </button>
          <button type="button" className="video-control video-control-main" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <button type="button" className="video-control" onClick={() => seekBy(1)} aria-label="Forward one second">
            <SkipForward size={16} />
          </button>

          <span className="video-clock">{formatClock(currentTime)}</span>

          <div
            className="video-scrub"
            role="slider"
            tabIndex={0}
            aria-label="Video position"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={relativeClock(currentTime)}
            aria-orientation="horizontal"
            onPointerDown={onScrub}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") seekBy(1);
              if (event.key === "ArrowLeft") seekBy(-1);
            }}
            style={{ "--progress": progress } as CSSProperties}
          >
            <span className="video-scrub-fill" />
            <span className="video-scrub-handle" />
            {events.map((event) => (
              <span
                key={event.label}
                className={`video-marker video-marker-${event.type}`}
                style={{ left: `${(event.t / duration) * 100}%` }}
                title={`${event.label} · ${event.t.toFixed(2)} s`}
              />
            ))}
          </div>

          <span className="video-clock video-clock-total">{formatClock(duration)}</span>

          <button type="button" className="video-control video-speed" onClick={setPlaybackSpeed} aria-label={`Playback speed ${speed}×`}>
            {speed}×
          </button>

          <button type="button" className="video-impact-button" onClick={() => seek(IMPACT)} aria-label="Jump to impact">
            <RotateCcw size={13} />
            <span>Jump to impact</span>
          </button>
        </div>
      </div>

      <div className="evidence-readouts">
        <div className="readout-clock">
          <span className="readout-label">CURSOR</span>
          <strong>{relativeClock(currentTime)}</strong>
          <span className="readout-sub">{formatClock(currentTime)} from start</span>
        </div>

        <div className="readout-card">
          <span className="readout-label"><i className="legend-dot legend-dot-lime" /> v56 · SPEED</span>
          <strong>{v56Speed === null ? "—" : `${v56Speed.toFixed(1)} km/h`}</strong>
          <span className="readout-sub">{v56Speed === null ? "outside track window" : "measured sample"}</span>
        </div>

        <div className="readout-card">
          <span className="readout-label"><i className="legend-dot legend-dot-ember" /> v53 · SPEED</span>
          <strong>{v53Speed === null ? "—" : `${v53Speed.toFixed(1)} km/h`}</strong>
          <span className="readout-sub">{v53Speed === null ? "outside track window" : "measured sample"}</span>
        </div>

        <div className="readout-card">
          <span className="readout-label">AT IMPACT</span>
          <strong>6.6 m</strong>
          <span className="readout-sub">separation · v53 + v56</span>
        </div>
      </div>

      <div className="evidence-lower">
        <div className="evidence-chart">
          <div className="evidence-chart-head">
            <div>
              <span className="readout-label">SPEED TRACE</span>
              <strong>Two vehicles through the crash window</strong>
            </div>
            <div className="chart-legend">
              <span><i className="legend-dot legend-dot-lime" /> v56</span>
              <span><i className="legend-dot legend-dot-ember" /> v53</span>
            </div>
          </div>
          <svg viewBox="0 0 270 104" role="img" aria-label="Speed of v53 and v56 through the impact window. v56 falls from 18 to 3.9 kilometres per hour, then recovers as it separates. v53 eases from 10.5 to 9.">
            <g className="kin-grid">
              <path d="M10 20h250M10 56h250M10 92h250" />
            </g>
            <path d={chartPath(v56)} className="trace trace-lime" fill="none" />
            <path d={chartPath(v53)} className="trace trace-ember" fill="none" />
            <line x1={(10 + ((IMPACT - 21.1) / 2.5) * 248).toFixed(1)} y1="10" x2={(10 + ((IMPACT - 21.1) / 2.5) * 248).toFixed(1)} y2="92" className="kin-impact" />
            {cursorX >= 10 && cursorX <= 260 && (
              <line x1={cursorX.toFixed(1)} y1="8" x2={cursorX.toFixed(1)} y2="94" className="trace-cursor" />
            )}
            <text x="10" y="103" className="chart-axis">21.1 s</text>
            <text x="244" y="103" className="chart-axis">23.6 s</text>
            <text x="252" y="18" className="chart-axis">20</text>
            <text x="252" y="90" className="chart-axis">0</text>
          </svg>
        </div>

        <div className="evidence-events">
          <span className="readout-label">EVENT LOG</span>
          {events.map((event) => (
            <button type="button" className="event-row" key={event.label} onClick={() => seek(event.t)}>
              <span className={`event-type event-type-${event.type}`} />
              <span className="event-time">T{event.t === IMPACT ? "" : event.t < IMPACT ? "−" : "+"}{Math.abs(event.t - IMPACT).toFixed(2)}</span>
              <span className="event-label">{event.label}</span>
              <span className="event-seek">↳</span>
            </button>
          ))}
          <p className="evidence-footnote">
            Reference incident, measured from <code>demo.mp4</code>. Timeline scrubbing changes the
            video source and the track readout together.
          </p>
        </div>
      </div>
    </div>
  );
}

export function Evidence() {
  return (
    <section className="section-pad evidence-section" id="evidence">
      <div className="container-x">
        <div className="section-head evidence-head" data-reveal>
          <div>
            <div className="section-kicker">
              <span className="section-index">03</span>
              <span>THE EVIDENCE</span>
              <span className="section-rule" />
            </div>
            <h2>
              Scrub the evidence.
              <span className="serif"> Not the spreadsheet.</span>
            </h2>
          </div>
          <p>
            The original footage and the reconstructed kinematics share one clock. Move the cursor,
            and both answer at once — down to the measured sample.
          </p>
        </div>

        <EvidencePlayer />

        <div className="evidence-note" data-reveal>
          <span className="evidence-note-index">REAL DATA</span>
          <p>
            This player reads the bundled reference scene. The speed traces are sampled from the
            scene&rsquo;s measured tracks; the impact time comes from the scene manifest. No synthetic
            motion.
          </p>
        </div>
      </div>
    </section>
  );
}
