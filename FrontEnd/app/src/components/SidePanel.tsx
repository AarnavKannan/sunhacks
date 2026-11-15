import { SceneArt } from "@/components/SceneArt";
import { formatBytes, formatClock } from "@/lib/time";
import { ingestFiles } from "@/lib/ingest";
import { describeEnvironment } from "@/scene/environment";
import { useAppStore } from "@/store/useAppStore";
import { Clock, CloudSun, Film, LocateFixed, MapPin, PanelLeftClose, PanelLeftOpen, Play, Search, Upload, X, Zap } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

export function SidePanel({ dragOver }: { dragOver: boolean }) {
  const panelOpen = useAppStore((state) => state.panelOpen);
  const scenes = useAppStore((state) => state.scenes);
  const uploads = useAppStore((state) => state.uploads);
  const selectedId = useAppStore((state) => state.selectedId);
  const search = useAppStore((state) => state.search);
  const playing = useAppStore((state) => state.playing);
  const impactTime = useAppStore((state) => state.impactTime);
  const setSearch = useAppStore((state) => state.setSearch);
  const selectScene = useAppStore((state) => state.selectScene);
  const togglePlay = useAppStore((state) => state.togglePlay);
  const jumpToImpact = useAppStore((state) => state.jumpToImpact);
  const resetCamera = useAppStore((state) => state.resetCamera);
  const setPanelOpen = useAppStore((state) => state.setPanelOpen);
  const removeUpload = useAppStore((state) => state.removeUpload);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isStaging, setIsStaging] = useState(false);
  const [stageMessage, setStageMessage] = useState("");

  const stageUploads = async () => {
    if (!window.reconstruct?.stageVideos) {
      setStageMessage("Local video staging is available in the Electron desktop app.");
      return;
    }

    setIsStaging(true);
    setStageMessage("Copying videos and recording SHA-256 hashes…");
    try {
      const incident = await window.reconstruct.stageVideos(uploads.map((upload) => upload.file));
      setStageMessage(
        `Incident ${incident.incidentId.slice(0, 8)} · ${incident.videos.length} video${incident.videos.length === 1 ? "" : "s"} copied and hashed.`,
      );
    } catch (error) {
      setStageMessage(error instanceof Error ? `Could not stage footage: ${error.message}` : "Could not stage footage.");
    } finally {
      setIsStaging(false);
    }
  };

  const query = search.trim().toLowerCase();
  const visible = scenes.filter((scene) => {
    if (!query) return true;
    return (
      scene.title.toLowerCase().includes(query) ||
      scene.location.toLowerCase().includes(query) ||
      scene.detail.toLowerCase().includes(query)
    );
  });

  return (
    <aside className={`absolute inset-y-0 left-0 z-30 flex w-[400px] flex-col bg-white shadow-[4px_0_24px_rgba(0,0,0,0.18)] transition-transform duration-200 ease-in-out ${panelOpen ? "translate-x-0" : "-translate-x-[340px]"}`}>
      <div className={`flex items-center gap-3 px-4 pt-4 ${panelOpen ? "" : "justify-end"}`}>
        {panelOpen && (
          <>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1a73e8] text-sm font-semibold text-white">
              R
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium leading-tight text-slate-900">Reconstruct</div>
              <div className="text-xs text-slate-500">
                {window.reconstruct?.isDesktop ? "Desktop viewer" : "Incident viewer"}
              </div>
            </div>
          </>
        )}
        <button
          type="button"
          className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
          aria-label={panelOpen ? "Hide scenes panel" : "Show scenes panel"}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          {panelOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>

      {panelOpen && (
        <>
      <div className="px-4 pt-3">
        <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2.5 shadow-sm focus-within:border-[#1a73e8] focus-within:bg-white">
          <Search size={18} className="text-slate-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search processed scenes"
            className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          {search && (
            <button type="button" aria-label="Clear search" onClick={() => setSearch("")}>
              <X size={16} className="text-slate-400" />
            </button>
          )}
        </label>
      </div>

      <div className="px-4 pt-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`flex w-full flex-col items-center rounded-2xl border border-dashed px-4 py-4 text-center transition ${
            dragOver ? "border-[#1a73e8] bg-blue-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100"
          }`}
        >
          <Upload size={20} className="text-[#1a73e8]" />
          <span className="mt-2 text-sm font-medium text-slate-800">Upload footage</span>
          <span className="mt-1 text-xs leading-relaxed text-slate-500">
            Drop videos to queue them for reconstruction, or drop a .spz / .ply to view it now.
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          accept="video/*,.spz,.ply,.splat,.ksplat,.sog,.zip"
          onChange={(event) => {
            if (event.target.files?.length) void ingestFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <div className="mt-3 flex-1 overflow-y-auto px-4 pb-4">
        {uploads.length > 0 && (
          <section className="mb-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-xs font-medium tracking-wide text-slate-500 uppercase">Upload queue</h2>
              <button
                type="button"
                disabled={isStaging}
                onClick={() => void stageUploads()}
                className="rounded-md bg-[#e8f0fe] px-2 py-1 text-xs font-medium text-[#1a73e8] disabled:opacity-50"
              >
                {isStaging ? "Staging…" : "Stage footage"}
              </button>
            </div>
            {stageMessage && <p className="mb-2 text-xs text-slate-600" role="status">{stageMessage}</p>}
            <ul className="space-y-2">
              {uploads.map((upload) => (
                <li key={upload.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                  <Film size={16} className="shrink-0 text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-800">{upload.name}</div>
                    <div className="text-xs text-slate-500">
                      {formatBytes(upload.size)} · Queued for the pipeline
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                      <CloudSun size={12} className="shrink-0" />
                      <span className="truncate">
                        {upload.analysis.state === "analyzing" && "Reading environment from footage…"}
                        {upload.analysis.state === "done" && describeEnvironment(upload.analysis.result.environment)}
                        {upload.analysis.state === "failed" && `Environment unknown: ${upload.analysis.error}`}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${upload.name}`}
                    className="rounded-full p-1 text-slate-400 hover:bg-slate-100"
                    onClick={() => removeUpload(upload.id)}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <h2 className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Processed scenes</h2>
        {visible.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">No scenes match that search.</p>
        ) : (
          <ul className="space-y-2">
            {visible.map((scene) => {
              const selected = scene.id === selectedId;
              return (
                <li key={scene.id}>
                  <button
                    type="button"
                    onClick={() => selectScene(scene.id)}
                    className={`w-full overflow-hidden rounded-2xl border text-left transition ${
                      selected ? "border-[#1a73e8] shadow-sm" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {selected ? (
                      <div className="h-[148px] overflow-hidden bg-slate-100">
                        <SceneArt sceneId={scene.id} large />
                      </div>
                    ) : null}
                    <div className="flex gap-3 p-3">
                      {!selected && (
                        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                          <SceneArt sceneId={scene.id} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-medium text-slate-900">{scene.title}</div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                          <MapPin size={12} />
                          <span className="truncate">{scene.location}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <Clock size={12} />
                            {formatClock(scene.duration)}
                          </span>
                          <span>·</span>
                          <span>{scene.kind === "splat" ? "Gaussian splat" : scene.detail}</span>
                        </div>
                      </div>
                    </div>
                  </button>

                  {selected && (
                    <div className="px-1 pt-3">
                      <div className="flex justify-around">
                        <Action icon={<Play size={18} />} label={playing ? "Pause" : "Play"} onClick={togglePlay} />
                        <Action
                          icon={<Zap size={18} />}
                          label="Impact"
                          onClick={jumpToImpact}
                          disabled={impactTime == null}
                        />
                        <Action icon={<LocateFixed size={18} />} label="Fit view" onClick={resetCamera} />
                      </div>
                      <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-600">
                        <CloudSun size={14} className="shrink-0 text-slate-500" />
                        <span className="truncate">
                          {describeEnvironment(scene.environment)}
                          {scene.environmentSource ? ` · from ${scene.environmentSource}` : " · default (no footage)"}
                        </span>
                      </div>
                      {scene.vehicles.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {scene.vehicles.map((vehicle) => (
                            <span
                              key={vehicle.id}
                              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"
                            >
                              <span className="h-2 w-2 rounded-full border border-black/10" style={{ background: vehicle.color }} />
                              {vehicle.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
        </>
      )}
    </aside>
  );
}

function Action({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-20 flex-col items-center gap-1 text-xs text-slate-600 disabled:opacity-40"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e8f0fe] text-[#1a73e8]">{icon}</span>
      {label}
    </button>
  );
}
