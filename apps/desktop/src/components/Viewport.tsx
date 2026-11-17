import { SourceVideo } from "@/components/SourceVideo";
import { getSplatFile } from "@/lib/splatFiles";
import { setActiveScene } from "@/scene/activeScene";
import { mountScene, type SceneHandle } from "@/scene/mountScene";
import { LEFT_RAIL, useAppStore } from "@/store/useAppStore";
import { Eye, LocateFixed, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelOpen = useAppStore((state) => state.panelOpen);
  const leftWidth = useAppStore((state) => state.leftWidth);
  const resizing = useAppStore((state) => state.resizing);
  const scene = useAppStore((state) => state.scenes.find((item) => item.id === state.selectedId));
  const following = useAppStore((state) => state.following);
  const pov = useAppStore((state) => state.pov);
  const hidden = useAppStore((state) => state.layers.hiddenVehicles);
  const showVideo = useAppStore((state) => state.layers.sourceVideo);
  const setCameraMode = useAppStore((state) => state.setCameraMode);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let frame = 0;
    let last = performance.now();

    /** Pushes the overlay and camera-mode state onto a freshly built scene. */
    const syncOverlays = (handle: SceneHandle) => {
      const state = useAppStore.getState();
      handle.setLayers(state.layers);
      handle.setMarkers(state.markers);
      handle.setFollow(state.following);
      handle.setPov(state.pov);
    };

    const applySelection = async (handle: SceneHandle) => {
      const state = useAppStore.getState();
      const current = state.scenes.find((item) => item.id === state.selectedId);
      if (!current) return;
      setError(null);
      if (current.kind === "splat") {
        const file = getSplatFile(current.id);
        if (!file) {
          setError("That splat file is no longer loaded.");
          return;
        }
        setLoading(true);
        try {
          await handle.showSplat(file.bytes, file.fileName, current.environment);
          handle.setTime(useAppStore.getState().time);
          syncOverlays(handle);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not load the splat.");
        } finally {
          setLoading(false);
        }
        return;
      }
      handle.showProxy(current.id, current.vehicles, current.environment, current.duration);
      handle.setTime(useAppStore.getState().time);
      syncOverlays(handle);
    };

    void (async () => {
      const handle = await mountScene(container, (adjustments) =>
        useAppStore.getState().setCameraAdjustments(adjustments),
      );
      if (disposed) {
        handle.dispose();
        return;
      }
      handleRef.current = handle;
      await applySelection(handle);
      setActiveScene(handle);

      const loop = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const state = useAppStore.getState();
        if (state.view === "viewer") {
          if (state.playing && !state.scrubbing) {
            const next = state.time + dt * state.speed;
            if (next >= state.duration) {
              // Hold on the last frame instead of looping, so the end of the clip can be studied.
              state.setTime(state.duration);
              state.setPlaying(false);
            } else {
              state.setTime(next);
            }
          }
          handle.setTime(useAppStore.getState().time);
          handle.render();
        }
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    })();

    const unsubscribe = useAppStore.subscribe((state, previous) => {
      const handle = handleRef.current;
      if (!handle) return;
      if (state.selectedId !== previous.selectedId) void applySelection(handle);
      if (state.cameraCommand.token !== previous.cameraCommand.token) {
        handle.setCameraAdjustments(state.cameraCommand.adjustments);
      }
      if (state.cameraResetToken !== previous.cameraResetToken) handle.resetCamera();
      if (state.following !== previous.following) handle.setFollow(state.following);
      if (state.pov !== previous.pov) handle.setPov(state.pov);
      if (state.layers !== previous.layers) handle.setLayers(state.layers);
      if (state.markers !== previous.markers) handle.setMarkers(state.markers);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      setActiveScene(null);
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!pov) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") useAppStore.getState().setCameraMode({ pov: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pov]);

  const vehicleLabel = (id: string | null) => scene?.vehicles.find((item) => item.id === id)?.label ?? id;
  // Overlays sit just right of the left panel (or its collapsed rail).
  const offsetStyle = { left: (panelOpen ? leftWidth : LEFT_RAIL) + 16 };
  const offset = resizing ? "" : "transition-[left] duration-200 ease-in-out";

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />

      <div className={`pointer-events-none absolute top-4 z-10 text-sm text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.55)] ${offset}`} style={offsetStyle}>
        <div className="text-base font-medium text-white">{scene?.title}</div>
        <div>
          {pov
            ? "Driver's-eye view · Esc to leave"
            : scene?.kind === "splat"
              ? "Gaussian splat · drag to orbit · scroll to zoom"
              : "Drag to orbit · scroll to zoom · right-drag to pan"}
        </div>
      </div>

      {(pov || following) && (
        <div className={`absolute top-16 z-10 flex items-center gap-2 rounded-full bg-[#071433]/80 py-1 pr-1 pl-3 text-xs text-white backdrop-blur-sm ${offset}`} style={offsetStyle}>
          {pov ? <Eye size={14} /> : <LocateFixed size={14} />}
          <span>
            {pov ? `Riding with the ${vehicleLabel(pov)} · approximate eye point` : `Following the ${vehicleLabel(following)}`}
          </span>
          <button
            type="button"
            aria-label={pov ? "Leave the driver's-eye view" : "Stop following"}
            className="rounded-full p-1 hover:bg-white/15"
            onClick={() => setCameraMode(pov ? { pov: null } : { following: null })}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="pointer-events-none absolute top-4 right-4 z-10 flex flex-col items-end gap-2">
        {showVideo && scene?.sourceVideo && <SourceVideo key={scene.id} url={scene.sourceVideo.url} name={scene.sourceVideo.name} />}
        {scene &&
          scene.vehicles.length > 0 &&
          // Busy scenes (Gemini reconstructions with dozens of cars): chips for the crash vehicles only, plus a count.
          (scene.vehicles.length > 8 ? scene.vehicles.filter((v) => scene.crashVehicles.includes(v.id)) : scene.vehicles).map((vehicle) => (
            <span
              key={vehicle.id}
              className={`inline-flex items-center gap-2 rounded-full bg-[#071433]/70 px-2.5 py-1 text-xs text-white backdrop-blur-sm ${
                hidden.includes(vehicle.id) ? "opacity-40 line-through" : ""
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full border border-white/40" style={{ background: vehicle.color }} />
              {vehicle.label}
            </span>
          ))}
        {scene && scene.vehicles.length > 8 && (
          <span className="inline-flex items-center rounded-full bg-[#071433]/70 px-2.5 py-1 text-xs text-white/85 backdrop-blur-sm">
            +{scene.vehicles.length - scene.crashVehicles.length} other vehicles
          </span>
        )}
      </div>

      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0a2378]/50 text-sm text-white">
          Loading splat…
        </div>
      )}
      {error && (
        <div className={`absolute top-20 right-4 z-10 rounded-xl bg-red-600/90 px-3 py-2 text-sm text-white ${offset}`} style={offsetStyle}>
          {error}
        </div>
      )}
    </div>
  );
}
