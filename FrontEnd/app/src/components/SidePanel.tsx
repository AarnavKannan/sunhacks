import { appSceneController } from "@/assistant/sceneController";
import { cancelExport } from "@/lib/exportVideo";
import { formatClock } from "@/lib/time";
import { describeEnvironment } from "@/scene/environment";
import type { CameraAdjustments } from "@/scene/camera";
import { ResizeHandle } from "@/components/ResizeHandle";
import { LEFT_RAIL, useAppStore } from "@/store/useAppStore";
import type { CameraPreset, Vec3 } from "@assistant/types";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CloudSun,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  Film,
  GripVertical,
  LocateFixed,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Route,
  Square,
  Trash2,
  Video,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type ReactNode } from "react";

const PRESETS: { id: CameraPreset; label: string }[] = [
  { id: "front", label: "Front" },
  { id: "back", label: "Back" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "iso", label: "Iso" },
  { id: "dimetric", label: "Dimetric" },
  { id: "trimetric", label: "Trimetric" },
];

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

export function SidePanel() {
  const dragStartRef = useRef<{ pointerX: number; x: number } | null>(null);
  const dragXRef = useRef<number | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isResizing = useAppStore((state) => state.resizing);
  const setIsResizing = useAppStore((state) => state.setResizing);
  const leftWidth = useAppStore((state) => state.leftWidth);
  const setLeftWidth = useAppStore((state) => state.setLeftWidth);
  const hiddenX = -(leftWidth - LEFT_RAIL);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const panelOpen = useAppStore((state) => state.panelOpen);
  const scene = useAppStore((state) => state.scenes.find((item) => item.id === state.selectedId));
  const cameraAdjustments = useAppStore((state) => state.cameraAdjustments);
  const playing = useAppStore((state) => state.playing);
  const impactTime = useAppStore((state) => state.impactTime);
  const layers = useAppStore((state) => state.layers);
  const markers = useAppStore((state) => state.markers);
  const following = useAppStore((state) => state.following);
  const pov = useAppStore((state) => state.pov);
  const exportJob = useAppStore((state) => state.exportJob);
  const applyCameraAdjustments = useAppStore((state) => state.applyCameraAdjustments);
  const togglePlay = useAppStore((state) => state.togglePlay);
  const jumpToImpact = useAppStore((state) => state.jumpToImpact);
  const resetCamera = useAppStore((state) => state.resetCamera);
  const setPanelOpen = useAppStore((state) => state.setPanelOpen);
  const closeScene = useAppStore((state) => state.closeScene);
  const setLayers = useAppStore((state) => state.setLayers);
  const setVehicleHidden = useAppStore((state) => state.setVehicleHidden);
  const removeMarker = useAppStore((state) => state.removeMarker);

  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      const result = (await action()) as { clamped?: boolean } | undefined;
      if (result && typeof result === "object" && result.clamped) setNotice({ text: "Stopped at the edge of the scene.", error: false });
      else if (success) setNotice({ text: success, error: false });
      else setNotice(null);
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "That didn't work.", error: true });
    }
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 6000 : 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const startPanelDrag = (event: ReactDragEvent<HTMLButtonElement>) => {
    const x = panelOpen ? 0 : hiddenX;
    dragStartRef.current = { pointerX: event.clientX, x };
    dragXRef.current = x;
    setDragX(x);
    setIsDragging(true);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "scene-panel");
  };

  const dragPanel = (event: ReactDragEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    if (!start || event.clientX === 0) return;
    const x = Math.min(0, Math.max(hiddenX, start.x + event.clientX - start.pointerX));
    dragXRef.current = x;
    setDragX(x);
  };

  const finishPanelDrag = () => {
    const start = dragStartRef.current;
    if (!start) return;
    setPanelOpen((dragXRef.current ?? start.x) > hiddenX / 2);
    dragStartRef.current = null;
    dragXRef.current = null;
    setDragX(null);
    setIsDragging(false);
  };

  const updateCamera = (field: keyof CameraAdjustments, value: number) => {
    if (!Number.isFinite(value)) return;
    applyCameraAdjustments({ ...cameraAdjustments, [field]: value });
  };

  if (!scene) return null;

  return (
    <aside
      style={{ width: leftWidth, transform: `translateX(${dragX ?? (panelOpen ? 0 : hiddenX)}px)` }}
      className={`absolute inset-y-0 left-0 z-30 flex flex-col bg-white shadow-[4px_0_24px_rgba(0,0,0,0.18)] ${
        isDragging || isResizing ? "" : "transition-transform duration-200 ease-in-out"
      }`}
    >
      {panelOpen && (
        <ResizeHandle edge="right" width={leftWidth} onResize={setLeftWidth} onResizingChange={setIsResizing} label="Resize the panel" />
      )}
      <div className={`flex items-center gap-2 px-3 pt-3 ${panelOpen ? "" : "justify-end"}`}>
        {panelOpen && (
          <>
            <button
              type="button"
              draggable
              aria-label="Drag the panel horizontally"
              title="Drag left or right to slide the panel"
              className="grid h-8 w-5 shrink-0 cursor-ew-resize place-items-center rounded text-slate-300 hover:bg-slate-100"
              onDragStart={startPanelDrag}
              onDrag={dragPanel}
              onDragEnd={finishPanelDrag}
            >
              <GripVertical size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={closeScene}
              className="flex items-center gap-1.5 rounded-full py-1.5 pr-3 pl-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              title="Back to the library"
            >
              <ArrowLeft size={18} />
              Library
            </button>
            <div className="flex-1" />
          </>
        )}
        <button
          type="button"
          draggable={!panelOpen}
          className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
          aria-label={panelOpen ? "Hide the panel" : "Show the panel"}
          onClick={() => setPanelOpen(!panelOpen)}
          onDragStart={panelOpen ? undefined : startPanelDrag}
          onDrag={panelOpen ? undefined : dragPanel}
          onDragEnd={panelOpen ? undefined : finishPanelDrag}
        >
          {panelOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>

      {panelOpen && (
        <div className="mt-1 flex-1 overflow-y-auto px-4 pb-6">
          <div className="pt-1 pb-3">
            <div className="text-lg leading-tight font-medium text-slate-900">{scene.title}</div>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
              <MapPin size={12} className="shrink-0" />
              <span className="truncate">{scene.location}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <CloudSun size={13} className="shrink-0" />
              <span className="truncate">
                {describeEnvironment(scene.environment)}
                {scene.environmentSource ? ` · from ${scene.environmentSource}` : ""}
              </span>
            </div>
            {scene.impactTime != null && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-red-600">
                <Zap size={13} className="shrink-0" />
                Crash from {fmt(scene.impactTime)} s to {fmt(scene.crashEnd ?? scene.impactTime)} s of {formatClock(scene.duration)}
              </div>
            )}
          </div>

          <div className="flex justify-around pb-3">
            <Action icon={playing ? <Pause size={18} /> : <Play size={18} />} label={playing ? "Pause" : "Play"} onClick={togglePlay} />
            <Action icon={<Zap size={18} />} label="Crash" onClick={jumpToImpact} disabled={impactTime == null} />
            <Action icon={<LocateFixed size={18} />} label="Fit view" onClick={resetCamera} />
            <Action
              icon={<Film size={18} />}
              label={layers.sourceVideo ? "Hide video" : "Footage"}
              onClick={() => setLayers({ sourceVideo: !layers.sourceVideo })}
              disabled={!scene.sourceVideo}
              title={scene.sourceVideo ? "Show the original footage, synced to the timeline" : "No source video for this reconstruction"}
            />
          </div>

          {notice && (
            <p
              role="status"
              className={`mb-3 rounded-xl px-3 py-2 text-xs ${notice.error ? "bg-red-50 text-red-700" : "bg-blue-50 text-[#1a56c4]"}`}
            >
              {notice.text}
            </p>
          )}

          <Section title="Standard views">
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => void run(() => appSceneController.preset(preset.id))}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:border-[#1a73e8] hover:text-[#1a73e8]"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </Section>

          <ExactMoves run={run} />

          <Section
            title="Camera relative to base view"
            action={
              <button type="button" onClick={resetCamera} className="rounded-md bg-white px-2 py-1 text-xs font-medium text-[#1a73e8] shadow-sm">
                Base view
              </button>
            }
          >
            <div className="grid grid-cols-3 gap-2">
              <NumberField label="Pan X (m)" value={cameraAdjustments.panX} step="0.1" onCommit={(value) => updateCamera("panX", value)} />
              <NumberField label="Pan Y (m)" value={cameraAdjustments.panY} step="0.1" onCommit={(value) => updateCamera("panY", value)} />
              <NumberField label="Pan Z (m)" value={cameraAdjustments.panZ} step="0.1" onCommit={(value) => updateCamera("panZ", value)} />
              <NumberField label="Zoom (×)" value={cameraAdjustments.zoom} step="0.01" min="0.1" onCommit={(value) => updateCamera("zoom", value)} />
              <NumberField label="Tilt (°)" value={cameraAdjustments.tilt} step="0.1" onCommit={(value) => updateCamera("tilt", value)} />
              <NumberField label="Rotate (°)" value={cameraAdjustments.rotate} step="0.1" onCommit={(value) => updateCamera("rotate", value)} />
            </div>
          </Section>

          <Section title="Show">
            <Toggle icon={<Route size={15} />} label="Vehicle paths" checked={layers.trails} disabled={scene.vehicles.length === 0} onChange={(trails) => setLayers({ trails })} />
            <Toggle icon={<Square size={15} />} label="Scene boundary" checked={layers.bounds} onChange={(bounds) => setLayers({ bounds })} />
            <Toggle icon={<Crosshair size={15} />} label="Vehicle hitboxes" checked={layers.hitboxes} disabled={scene.vehicles.length === 0} onChange={(hitboxes) => setLayers({ hitboxes })} />
            <Toggle
              icon={<Film size={15} />}
              label="Original footage"
              checked={layers.sourceVideo}
              disabled={!scene.sourceVideo}
              onChange={(sourceVideo) => setLayers({ sourceVideo })}
            />
          </Section>

          {scene.vehicles.length > 0 && (
            <Section title="Vehicles">
              <ul className="space-y-1">
                {scene.vehicles.map((vehicle) => {
                  const hidden = layers.hiddenVehicles.includes(vehicle.id);
                  return (
                    <li key={vehicle.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-slate-50">
                      <span className="h-3 w-3 shrink-0 rounded-full border border-black/15" style={{ background: vehicle.color }} />
                      <span className={`min-w-0 flex-1 truncate text-sm ${hidden ? "text-slate-400 line-through" : "text-slate-800"}`}>{vehicle.label}</span>
                      <IconButton label={`Zoom in on the ${vehicle.label}`} onClick={() => void run(() => appSceneController.focus(vehicle.id))}>
                        <Crosshair size={15} />
                      </IconButton>
                      <IconButton
                        label={following === vehicle.id ? "Stop following" : `Follow the ${vehicle.label}`}
                        active={following === vehicle.id}
                        onClick={() => void run(() => appSceneController.follow(following === vehicle.id ? null : vehicle.id))}
                      >
                        <LocateFixed size={15} />
                      </IconButton>
                      <IconButton
                        label={pov === vehicle.id ? "Leave the driver's-eye view" : `Driver's-eye view from the ${vehicle.label}`}
                        active={pov === vehicle.id}
                        onClick={() => void run(() => appSceneController.pov(pov === vehicle.id ? null : vehicle.id))}
                      >
                        <Video size={15} />
                      </IconButton>
                      <IconButton label={hidden ? `Show the ${vehicle.label}` : `Hide the ${vehicle.label}`} onClick={() => setVehicleHidden(vehicle.id, !hidden)}>
                        {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                      </IconButton>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          <MarkersSection run={run} markers={markers} onRemove={removeMarker} />

          <Section title="Export video">
            <ExportControls duration={scene.duration} job={exportJob} run={run} />
          </Section>
        </div>
      )}
    </aside>
  );
}

type Runner = (action: () => Promise<unknown>, success?: string) => Promise<void>;

function ExactMoves({ run }: { run: Runner }) {
  const [degrees, setDegrees] = useState(30);
  const [meters, setMeters] = useState(5);
  const [position, setPosition] = useState<Vec3>([0, 20, 30]);
  const [target, setTarget] = useState<Vec3>([0, 0, 0]);
  const deg = Number.isFinite(degrees) ? degrees : 0;
  const m = Number.isFinite(meters) ? meters : 0;

  const loadCurrent = async () => {
    const state = await appSceneController.describe();
    setPosition(state.camera.position);
    setTarget(state.camera.target);
  };

  return (
    <Section title="Exact moves">
      <div className="flex items-end gap-2">
        <NumberField label="Turn by (°)" value={degrees} step="1" onCommit={setDegrees} live />
        <div className="flex gap-1 pb-0.5">
          <IconButton label={`Orbit ${deg}° left`} onClick={() => void run(() => appSceneController.orbit(-deg, 0))}>
            <RotateCcw size={15} />
          </IconButton>
          <IconButton label={`Orbit ${deg}° right`} onClick={() => void run(() => appSceneController.orbit(deg, 0))}>
            <RotateCw size={15} />
          </IconButton>
          <IconButton label={`Orbit ${deg}° higher`} onClick={() => void run(() => appSceneController.orbit(0, deg))}>
            <ChevronUp size={15} />
          </IconButton>
          <IconButton label={`Orbit ${deg}° lower`} onClick={() => void run(() => appSceneController.orbit(0, -deg))}>
            <ChevronDown size={15} />
          </IconButton>
        </div>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <NumberField label="Move by (m)" value={meters} step="0.5" onCommit={setMeters} live />
        <div className="flex gap-1 pb-0.5">
          <IconButton label={`Move ${m} m left`} onClick={() => void run(() => appSceneController.move(-m, 0, 0))}>
            <ChevronLeft size={15} />
          </IconButton>
          <IconButton label={`Move ${m} m right`} onClick={() => void run(() => appSceneController.move(m, 0, 0))}>
            <ChevronRight size={15} />
          </IconButton>
          <IconButton label={`Move ${m} m up`} onClick={() => void run(() => appSceneController.move(0, m, 0))}>
            <ChevronUp size={15} />
          </IconButton>
          <IconButton label={`Move ${m} m down`} onClick={() => void run(() => appSceneController.move(0, -m, 0))}>
            <ChevronDown size={15} />
          </IconButton>
          <IconButton label={`Move ${m} m forward`} onClick={() => void run(() => appSceneController.move(0, 0, m))}>
            <Plus size={15} />
          </IconButton>
        </div>
      </div>
      <p className="mt-3 mb-1 text-[11px] leading-relaxed text-slate-500">
        Exact camera placement, in meters from the crash point: +x east, +y up, −z north.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {(["x", "y", "z"] as const).map((axis, i) => (
          <NumberField key={`p${axis}`} label={`Camera ${axis}`} value={position[i]} step="0.5" live onCommit={(v) => setPosition((p) => p.map((q, j) => (j === i ? v : q)) as Vec3)} />
        ))}
        {(["x", "y", "z"] as const).map((axis, i) => (
          <NumberField key={`t${axis}`} label={`Look at ${axis}`} value={target[i]} step="0.5" live onCommit={(v) => setTarget((p) => p.map((q, j) => (j === i ? v : q)) as Vec3)} />
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void run(() => appSceneController.setCamera({ position, target }))}
          className="rounded-md bg-[#1a73e8] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1765cc]"
        >
          Place camera
        </button>
        <button
          type="button"
          onClick={() => void run(loadCurrent)}
          className="rounded-md bg-[#e8f0fe] px-3 py-1.5 text-xs font-medium text-[#1a73e8]"
        >
          Use current
        </button>
      </div>
    </Section>
  );
}

function MarkersSection({ run, markers, onRemove }: { run: Runner; markers: { id: string; label: string; entityId?: string }[]; onRemove: (id: string) => void }) {
  const [label, setLabel] = useState("");
  const add = () =>
    run(async () => {
      const text = label.trim() || `Marker ${markers.length + 1}`;
      const state = await appSceneController.describe();
      const point: Vec3 = [state.camera.target[0], 0, state.camera.target[2]];
      await appSceneController.addMarker(text, { point });
      setLabel("");
    });
  return (
    <Section title="Markers">
      <div className="flex gap-2">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void add();
          }}
          placeholder="Label for a pin at the view centre"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-[#1a73e8]"
        />
        <button type="button" onClick={() => void add()} className="rounded-lg bg-[#e8f0fe] px-2.5 text-xs font-medium text-[#1a73e8]">
          Drop pin
        </button>
      </div>
      {markers.length > 0 && (
        <ul className="mt-2 space-y-1">
          {markers.map((marker) => (
            <li key={marker.id} className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm text-slate-800 hover:bg-slate-50">
              <MapPin size={14} className="shrink-0 text-[#ff8a00]" />
              <span className="min-w-0 flex-1 truncate">{marker.label}</span>
              {marker.entityId && <span className="text-xs text-slate-500">on {marker.entityId}</span>}
              <IconButton label={`Remove ${marker.label}`} onClick={() => onRemove(marker.id)}>
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ExportControls({ duration, job, run }: { duration: number; job: ReturnType<typeof useAppStore.getState>["exportJob"]; run: Runner }) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(duration);
  useEffect(() => {
    setStart(0);
    setEnd(duration);
  }, [duration]);
  const busy = job?.status === "rendering" || job?.status === "saving";
  return (
    <div>
      <div className="flex items-end gap-2">
        <NumberField label="From (s)" value={start} step="0.1" live onCommit={setStart} />
        <NumberField label="To (s)" value={end} step="0.1" live onCommit={setEnd} />
        {busy ? (
          <button type="button" onClick={cancelExport} className="mb-0.5 rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run(() => appSceneController.exportVideo({ range: [start, end] }), "Recording the export. It plays through once in real time.")}
            className="mb-0.5 flex items-center gap-1 rounded-md bg-[#1a73e8] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1765cc]"
          >
            <Download size={14} />
            Export
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">Every frame is watermarked as a demonstrative reconstruction, not original footage.</p>
      {job && (
        <div className="mt-2 text-xs text-slate-600">
          {job.status === "rendering" && (
            <>
              <div className="mb-1">Recording… {Math.round(job.progress * 100)}%</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-[#1a73e8]" style={{ width: `${job.progress * 100}%` }} />
              </div>
            </>
          )}
          {job.status === "saving" && "Saving…"}
          {job.status === "done" && <span className="break-all text-green-700">Saved {job.path}</span>}
          {job.status === "cancelled" && "Export cancelled."}
          {job.status === "error" && <span className="text-red-700">Export failed: {job.error}</span>}
        </div>
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium tracking-wide text-slate-600 uppercase">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A number input that keeps what you're typing (including "-" or an empty box) and only
 * applies it on Enter or when you leave the field. `live` applies every valid keystroke.
 */
function NumberField({
  label,
  value,
  step,
  min,
  live = false,
  onCommit,
}: {
  label: string;
  value: number;
  step: string;
  min?: string;
  live?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(parsed)) onCommit(parsed);
    setDraft(null);
  };
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] font-medium text-slate-600">
      {label}
      <input
        type="number"
        inputMode="decimal"
        value={draft ?? fmt(value)}
        step={step}
        min={min}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number(event.target.value);
          if (live && event.target.value.trim() !== "" && Number.isFinite(parsed)) onCommit(parsed);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(null);
        }}
        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 tabular-nums outline-none focus:border-[#1a73e8]"
      />
    </label>
  );
}

function Toggle({ icon, label, checked, disabled = false, onChange }: { icon: ReactNode; label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={`flex items-center gap-2 rounded-lg px-1 py-1.5 text-sm ${disabled ? "text-slate-400" : "cursor-pointer text-slate-800 hover:bg-slate-100"}`}>
      <span className="text-slate-500">{icon}</span>
      <span className="flex-1">{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#1a73e8]" />
    </label>
  );
}

function IconButton({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
        active ? "bg-[#1a73e8] text-white" : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

function Action({
  icon,
  label,
  onClick,
  disabled = false,
  title,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className="flex w-20 flex-col items-center gap-1 text-xs text-slate-600 disabled:opacity-40"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e8f0fe] text-[#1a73e8]">{icon}</span>
      {label}
    </button>
  );
}
