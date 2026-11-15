import { getSplatFile } from "@/lib/splatFiles";
import { mountScene, type SceneHandle } from "@/scene/mountScene";
import { useAppStore } from "@/store/useAppStore";
import { PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelOpen = useAppStore((state) => state.panelOpen);
  const scene = useAppStore((state) => state.scenes.find((item) => item.id === state.selectedId));
  const setPanelOpen = useAppStore((state) => state.setPanelOpen);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let frame = 0;
    let last = performance.now();

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
          await handle.showSplat(file.bytes, file.fileName);
          handle.setTime(useAppStore.getState().time);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not load the splat.");
        } finally {
          setLoading(false);
        }
        return;
      }
      handle.showProxy(current.id, current.vehicles);
      handle.setTime(useAppStore.getState().time);
    };

    void (async () => {
      const handle = await mountScene(container);
      if (disposed) {
        handle.dispose();
        return;
      }
      handleRef.current = handle;
      await applySelection(handle);

      const loop = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const state = useAppStore.getState();
        if (state.playing && !state.scrubbing) {
          const next = state.time + dt;
          state.setTime(next >= state.duration ? 0 : next);
        }
        handle.setTime(useAppStore.getState().time);
        handle.render();
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    })();

    const unsubscribe = useAppStore.subscribe((state, previous) => {
      const handle = handleRef.current;
      if (!handle) return;
      if (state.selectedId !== previous.selectedId) void applySelection(handle);
      if (state.cameraResetToken !== previous.cameraResetToken) handle.resetCamera();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />

      {!panelOpen && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="absolute top-4 left-4 z-20 inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-lg"
        >
          <PanelLeftOpen size={16} />
          Scenes
        </button>
      )}

      <div className={`pointer-events-none absolute top-4 z-10 text-sm text-white/85 ${panelOpen ? "left-[416px]" : "left-4"}`}>
        <div className="text-base font-medium text-white">{scene?.title}</div>
        <div>{scene?.kind === "splat" ? "Gaussian splat" : "Drag to orbit · scroll to zoom · right-drag to pan"}</div>
      </div>

      {scene && scene.vehicles.length > 0 && (
        <div className="pointer-events-none absolute top-4 right-4 z-10 flex flex-col items-end gap-1.5">
          {scene.vehicles.map((vehicle) => (
            <span
              key={vehicle.id}
              className="inline-flex items-center gap-2 rounded-full bg-[#071433]/70 px-2.5 py-1 text-xs text-white backdrop-blur-sm"
            >
              <span className="h-2.5 w-2.5 rounded-full border border-white/40" style={{ background: vehicle.color }} />
              {vehicle.label}
            </span>
          ))}
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0a2378]/50 text-sm text-white">
          Loading splat…
        </div>
      )}
      {error && (
        <div className="absolute top-20 right-4 left-[416px] z-10 rounded-xl bg-red-600/90 px-3 py-2 text-sm text-white">
          {error}
        </div>
      )}
    </div>
  );
}
