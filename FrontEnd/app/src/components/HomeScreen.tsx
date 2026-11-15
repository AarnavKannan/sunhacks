import { SceneArt } from "@/components/SceneArt";
import { ingestFiles } from "@/lib/ingest";
import { formatBytes, formatClock } from "@/lib/time";
import { describeEnvironment } from "@/scene/environment";
import { useAppStore } from "@/store/useAppStore";
import { Clock, CloudSun, Film, Folder, FolderOpen, Layers, MapPin, Search, Upload, X, Zap } from "lucide-react";
import { useMemo, useRef, useState } from "react";

/** Library of reconstructions: folders on the left, tiles on the right. Opening one switches to the viewer. */
export function HomeScreen({ dragOver }: { dragOver: boolean }) {
  const scenes = useAppStore((state) => state.scenes);
  const uploads = useAppStore((state) => state.uploads);
  const search = useAppStore((state) => state.search);
  const homeFolder = useAppStore((state) => state.homeFolder);
  const setSearch = useAppStore((state) => state.setSearch);
  const setHomeFolder = useAppStore((state) => state.setHomeFolder);
  const openScene = useAppStore((state) => state.openScene);
  const removeUpload = useAppStore((state) => state.removeUpload);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isStaging, setIsStaging] = useState(false);
  const [stageMessage, setStageMessage] = useState("");

  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const scene of scenes) counts.set(scene.folder, (counts.get(scene.folder) ?? 0) + 1);
    return [...counts.entries()];
  }, [scenes]);

  const query = search.trim().toLowerCase();
  const visible = scenes.filter((scene) => {
    if (homeFolder && scene.folder !== homeFolder) return false;
    if (!query) return true;
    return [scene.title, scene.location, scene.detail, scene.folder].some((text) => text.toLowerCase().includes(query));
  });

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

  return (
    <div className="absolute inset-0 z-40 flex bg-white text-slate-900">
      <nav className="flex w-[248px] shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-4">
        <div className="flex items-center gap-3 px-2 pb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1a73e8] text-sm font-semibold text-white">R</div>
          <div>
            <div className="text-[15px] font-medium leading-tight">Reconstruct</div>
            <div className="text-xs text-slate-500">Incident library</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mb-4 flex items-center gap-2 self-start rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.2)] hover:bg-slate-50"
        >
          <Upload size={18} className="text-[#1a73e8]" />
          New upload
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

        <FolderButton label="All reconstructions" count={scenes.length} active={homeFolder === null} onClick={() => setHomeFolder(null)} all />
        {folders.map(([name, count]) => (
          <FolderButton key={name} label={name} count={count} active={homeFolder === name} onClick={() => setHomeFolder(name)} />
        ))}
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 px-6 pt-4 pb-3">
          <label className="flex max-w-[640px] flex-1 items-center gap-2 rounded-full bg-slate-100 px-4 py-2.5 focus-within:bg-white focus-within:shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
            <Search size={18} className="text-slate-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search reconstructions"
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-500"
            />
            {search && (
              <button type="button" aria-label="Clear search" onClick={() => setSearch("")}>
                <X size={16} className="text-slate-500" />
              </button>
            )}
          </label>
        </header>

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          <h1 className="pt-2 pb-4 text-[22px] font-normal text-slate-800">{homeFolder ?? "All reconstructions"}</h1>

          {dragOver && (
            <div className="mb-4 rounded-2xl border-2 border-dashed border-[#1a73e8] bg-blue-50 px-4 py-6 text-center text-sm text-[#1a73e8]">
              Drop videos to queue them for reconstruction, or a .spz / .ply to view it now.
            </div>
          )}

          {uploads.length > 0 && (
            <section className="mb-6 max-w-[760px] rounded-2xl border border-slate-200 p-4">
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
              {stageMessage && (
                <p className="mb-2 text-xs text-slate-600" role="status">
                  {stageMessage}
                </p>
              )}
              <ul className="space-y-2">
                {uploads.map((upload) => (
                  <li key={upload.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                    <Film size={16} className="shrink-0 text-slate-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-800">{upload.name}</div>
                      <div className="text-xs text-slate-500">{formatBytes(upload.size)} · Queued for the pipeline</div>
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

          {visible.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-500">
              {query ? "No reconstructions match that search." : "This folder is empty. Upload footage or a splat file to add one."}
            </p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
              {visible.map((scene) => (
                <li key={scene.id}>
                  <button
                    type="button"
                    onClick={() => openScene(scene.id)}
                    className="group w-full overflow-hidden rounded-2xl border border-slate-200 bg-white text-left transition hover:border-[#1a73e8] hover:shadow-md focus-visible:border-[#1a73e8] focus-visible:outline-none"
                  >
                    <div className="h-[148px] overflow-hidden bg-slate-100">
                      {scene.kind === "splat" ? (
                        <div className="flex h-full items-center justify-center text-slate-400">
                          <Layers size={40} />
                        </div>
                      ) : (
                        <SceneArt sceneId={scene.id} large />
                      )}
                    </div>
                    <div className="p-3">
                      <div className="truncate text-[15px] font-medium text-slate-900">{scene.title}</div>
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                        <MapPin size={12} className="shrink-0" />
                        <span className="truncate">{scene.location}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock size={12} />
                          {formatClock(scene.duration)}
                        </span>
                        <span>·</span>
                        <span>{scene.kind === "splat" ? "Gaussian splat" : `${scene.vehicles.length} vehicles`}</span>
                        {scene.impactTime != null && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1 text-red-600">
                              <Zap size={12} />
                              Crash at {scene.impactTime.toFixed(1)} s
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}

function FolderButton({ label, count, active, onClick, all = false }: { label: string; count: number; active: boolean; onClick: () => void; all?: boolean }) {
  const Icon = all ? Layers : active ? FolderOpen : Folder;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-full px-3 py-2 text-left text-sm ${
        active ? "bg-[#c2e7ff] font-medium text-slate-900" : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      <Icon size={18} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs text-slate-500">{count}</span>
    </button>
  );
}
