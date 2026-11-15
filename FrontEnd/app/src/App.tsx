import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  Clock3,
  FileVideo2,
  Focus,
  Gauge,
  Layers3,
  MapPin,
  Maximize2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import SceneViewer from "./SceneViewer";
import { useSceneStore, type SceneId } from "./store";

const demoScenes: Array<{
  id: SceneId;
  title: string;
  subtitle: string;
  time: string;
}> = [
  { id: "intersection", title: "East Mesa intersection", subtitle: "2 vehicles · 12.0 sec", time: "Today" },
  { id: "parking", title: "Parking lot incident", subtitle: "2 vehicles · 08.4 sec", time: "Yesterday" },
];

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${remainder}`;
}

export default function App() {
  const sceneId = useSceneStore((state) => state.sceneId);
  const currentTime = useSceneStore((state) => state.currentTime);
  const duration = useSceneStore((state) => state.duration);
  const isPlaying = useSceneStore((state) => state.isPlaying);
  const setSceneId = useSceneStore((state) => state.setSceneId);
  const setCurrentTime = useSceneStore((state) => state.setCurrentTime);
  const setIsPlaying = useSceneStore((state) => state.setIsPlaying);
  const [footage, setFootage] = useState<File[]>([]);
  const [uploadMessage, setUploadMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [viewerError, setViewerError] = useState("");
  const [showDetails, setShowDetails] = useState(true);
  const [cameraPreset, setCameraPreset] = useState<"iso" | "top">("iso");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scene = useMemo(() => demoScenes.find((item) => item.id === sceneId) ?? demoScenes[0], [sceneId]);

  const reportViewerError = useCallback((message: string) => {
    setViewerError(message);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      const next = useSceneStore.getState().currentTime + 0.04;
      if (next >= duration) {
        setCurrentTime(duration);
        setIsPlaying(false);
      } else {
        setCurrentTime(next);
      }
    }, 40);
    return () => window.clearInterval(timer);
  }, [duration, isPlaying, setCurrentTime, setIsPlaying]);

  const addFiles = (files: FileList | File[]) => {
    const selected = Array.from(files).filter((file) => file.type.startsWith("video/"));
    if (!selected.length) {
      setUploadMessage("Choose a video file to add footage.");
      return;
    }
    setFootage((current) => [...current, ...selected]);
    setUploadMessage(`${selected.length} video${selected.length === 1 ? "" : "s"} staged locally.`);
  };

  const seekToImpact = () => setCurrentTime(6.4);

  return (
    <main className="app-shell">
      <aside className="scene-drawer">
        <div className="brand-row">
          <div className="brand-mark"><Layers3 size={18} strokeWidth={2.2} /></div>
          <div className="brand-copy">
            <span className="brand-name">reconstruct</span>
            <span className="brand-caption">INCIDENT VIEWER</span>
          </div>
          <button className="icon-button drawer-collapse" aria-label="Collapse scene panel">
            <ChevronLeft size={17} />
          </button>
        </div>

        <div className="drawer-heading">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h1>Scenes</h1>
          </div>
          <button className="icon-button" aria-label="Scene settings"><MoreHorizontal size={19} /></button>
        </div>

        <div className="search-box">
          <Search size={16} />
          <input aria-label="Search scenes" placeholder="Search scenes" />
          <span className="search-shortcut">⌘ K</span>
        </div>

        <section className="upload-section">
          <div className="section-title-row">
            <h2>New reconstruction</h2>
            <span className="local-tag"><ShieldCheck size={12} /> LOCAL</span>
          </div>
          <div
            className={`upload-dropzone ${isDragging ? "drag-active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              addFiles(event.dataTransfer.files);
            }}
          >
            <div className="upload-icon"><Upload size={17} /></div>
            <strong>Upload incident footage</strong>
            <span>Drag videos here or browse files</span>
            <button className="browse-button" onClick={() => fileInputRef.current?.click()}>
              <Plus size={14} /> Add videos
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              multiple
              hidden
              onChange={(event) => {
                if (event.currentTarget.files) addFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </div>
          {footage.length > 0 && (
            <div className="staged-files">
              <div className="staged-header"><span>STAGED FOOTAGE</span><span>{footage.length}</span></div>
              {footage.map((file, index) => (
                <div className="staged-file" key={`${file.name}-${index}`}>
                  <FileVideo2 size={15} />
                  <span title={file.name}>{file.name}</span>
                  <button
                    className="file-remove"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setFootage((files) => files.filter((_, fileIndex) => fileIndex !== index))}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                className="prepare-button"
                onClick={() => setUploadMessage("Footage is staged on this device. Connect the reconstruction pipeline to process it.")}
              >
                Prepare reconstruction <ArrowUpRight size={14} />
              </button>
              <p className="upload-note">Files stay local in this preview. Processing is not connected yet.</p>
            </div>
          )}
          {uploadMessage && <p className="upload-feedback" role="status">{uploadMessage}</p>}
        </section>

        <div className="saved-heading">
          <div className="section-title-row">
            <h2>Ready to explore</h2>
            <span className="scene-count">02</span>
          </div>
          <span className="saved-subtitle">Pre-reconstructed scenes</span>
        </div>

        <div className="scene-list">
          {demoScenes.map((item, index) => (
            <button
              className={`scene-card ${sceneId === item.id ? "scene-card-active" : ""}`}
              key={item.id}
              onClick={() => setSceneId(item.id)}
            >
              <span className={`scene-thumb scene-thumb-${index + 1}`}>
                <span className="thumb-road" />
                <span className="thumb-car thumb-car-one" />
                <span className="thumb-car thumb-car-two" />
                <span className="thumb-splat thumb-splat-one" />
                <span className="thumb-splat thumb-splat-two" />
                {sceneId === item.id && <span className="thumb-check"><Check size={12} /></span>}
              </span>
              <span className="scene-card-copy">
                <strong>{item.title}</strong>
                <span>{item.subtitle}</span>
                <small><span className="ready-dot" /> Ready <span className="scene-time">{item.time}</span></small>
              </span>
              <ChevronDown className="scene-card-chevron" size={15} />
            </button>
          ))}
        </div>

        <div className="drawer-footer">
          <div className="profile-avatar">AK</div>
          <div className="profile-copy"><strong>Analyst workspace</strong><span>Local session</span></div>
          <button className="icon-button" aria-label="Workspace settings"><Settings2 size={17} /></button>
        </div>
      </aside>

      <section className="viewer-shell">
        <SceneViewer onRendererError={reportViewerError} cameraPreset={cameraPreset} />
        <div className="viewer-vignette" />

        <header className="viewer-topbar">
          <div className="breadcrumbs">
            <span className="crumb-muted">Scenes</span>
            <span className="crumb-divider">/</span>
            <strong>{scene.title}</strong>
            <span className="demo-badge"><span /> DEMO SCENE</span>
          </div>
          <div className="topbar-actions">
            <button className="topbar-button"><ArrowDownToLine size={15} /> Export <ChevronDown size={13} /></button>
            <button className="avatar-button" aria-label="Account menu">AK</button>
          </div>
        </header>

        {viewerError && (
          <div className="viewer-error" role="alert">
            <AlertCircle size={16} /> {viewerError}
          </div>
        )}

        <div className="scene-label">
          <div className="label-icon"><MapPin size={16} /></div>
          <div><span>INCIDENT LOCATION</span><strong>East Mesa · Arizona</strong></div>
          <button className="icon-button label-more" aria-label="Location details"><MoreHorizontal size={17} /></button>
        </div>

        <div className="viewer-toolbar">
          <button className="tool-button tool-button-active" title="Select"><Focus size={17} /></button>
          <button className="tool-button" title="Measure"><SlidersHorizontal size={17} /></button>
          <span className="tool-divider" />
          <button className="tool-button" title="Reset view" onClick={() => setCameraPreset("iso")}>
            <RotateCcw size={16} />
          </button>
        </div>

        <div className="view-controls">
          <button className="view-cube" title="Isometric view" onClick={() => setCameraPreset("iso")}>
            <span>3D</span><small>ISO</small>
          </button>
          <button className="view-control-button" title="Top view" onClick={() => setCameraPreset("top")}>
            <Maximize2 size={15} />
          </button>
        </div>

        <div className="scene-info-card">
          <div className="info-card-heading"><span className="status-live" /> RECONSTRUCTION OVERVIEW</div>
          <div className="info-card-title">Impact sequence</div>
          <button className="impact-jump" onClick={seekToImpact}>
            <span className="impact-icon"><MapPin size={14} /></span>
            <span><strong>Impact detected</strong><small>Jump to 00:06.40</small></span>
            <ArrowUpRight size={15} />
          </button>
          <div className="info-card-stats">
            <div><span>VEHICLES</span><strong>02</strong></div>
            <div><span>DURATION</span><strong>{duration.toFixed(1)} <small>s</small></strong></div>
            <div><span>CONFIDENCE</span><strong>84<small>%</small></strong></div>
          </div>
        </div>

        <button className="details-toggle" onClick={() => setShowDetails((value) => !value)}>
          <ChevronDown size={14} className={showDetails ? "" : "rotate-chevron"} />
          {showDetails ? "Hide scene details" : "Show scene details"}
        </button>

        <div className="entity-tags">
          <span className="entity-pill"><i className="entity-dot red-dot" /> Vehicle 01</span>
          <span className="entity-pill"><i className="entity-dot gold-dot" /> Vehicle 02</span>
        </div>

        <section className="timeline-panel" aria-label="Scene timeline">
          <div className="timeline-topline">
            <div className="timeline-title">
              <span className="timeline-icon"><Clock3 size={16} /></span>
              <div><strong>Incident timeline</strong><span>Drag to explore the reconstruction</span></div>
            </div>
            <div className="timeline-options">
              <button className="speed-button" onClick={() => setCurrentTime(0)} title="Jump to start"><RotateCcw size={14} /></button>
              <button className="speed-button">1× <ChevronDown size={12} /></button>
              <button className="speed-button" title="Timeline settings"><Settings2 size={14} /></button>
            </div>
          </div>
          <div className="time-readout">
            <span className="current-time">{formatTime(currentTime)}</span>
            <span className="time-relative">{currentTime < 6.4 ? `T−${(6.4 - currentTime).toFixed(2)}s` : `T+${(currentTime - 6.4).toFixed(2)}s`}</span>
            <span className="time-total">{formatTime(duration)}</span>
          </div>
          <div className="slider-wrap">
            <button
              className="play-button"
              aria-label={isPlaying ? "Pause timeline" : "Play timeline"}
              onClick={() => {
                if (currentTime >= duration) setCurrentTime(0);
                setIsPlaying(!isPlaying);
              }}
            >
              {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
            </button>
            <div className="range-area">
              <div className="range-markers">
                <span className="impact-marker" style={{ left: `${(6.4 / duration) * 100}%` }}>
                  <i /><b>IMPACT</b>
                </span>
                <span className="braking-marker" style={{ left: `${(4.2 / duration) * 100}%` }} title="Braking starts" />
              </div>
              <input
                aria-label="Timeline position"
                className="timeline-range"
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={currentTime}
                style={{ "--range-progress": `${(currentTime / duration) * 100}%` } as CSSProperties}
                onPointerDown={() => setIsPlaying(false)}
                onChange={(event) => setCurrentTime(Number(event.currentTarget.value))}
              />
              <div className="timeline-ticks" aria-hidden="true">
                <span>00:00</span><span>00:03</span><span>00:06</span><span>00:09</span><span>00:12</span>
              </div>
            </div>
          </div>
          <div className="timeline-footer">
            <span><i className="legend-impact" /> Impact</span>
            <span><i className="legend-brake" /> Braking begins</span>
            <button onClick={() => setCurrentTime(6.4)}><Gauge size={13} /> View kinematics</button>
          </div>
        </section>

        <div className={`quick-stats ${showDetails ? "" : "quick-stats-hidden"}`}>
          <span><i className="entity-dot red-dot" /> Toyota · <b>38 mph</b></span>
          <span><i className="entity-dot gold-dot" /> Sedan · <b>22 mph</b></span>
          <span className="stats-time"><Clock3 size={13} /> T−2.60 s</span>
        </div>

        <div className="viewer-bottom-note"><span className="note-dot" /> Demonstrative reconstruction · Not original footage</div>
      </section>
    </main>
  );
}
