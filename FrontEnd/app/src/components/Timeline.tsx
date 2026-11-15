import { formatClock, formatRelative } from "@/lib/time";
import { useAppStore } from "@/store/useAppStore";
import { Pause, Play } from "lucide-react";
import { useRef } from "react";

export function Timeline() {
  const panelOpen = useAppStore((state) => state.panelOpen);
  const time = useAppStore((state) => state.time);
  const duration = useAppStore((state) => state.duration);
  const impactTime = useAppStore((state) => state.impactTime);
  const playing = useAppStore((state) => state.playing);
  const setTime = useAppStore((state) => state.setTime);
  const togglePlay = useAppStore((state) => state.togglePlay);
  const setScrubbing = useAppStore((state) => state.setScrubbing);
  const trackRef = useRef<HTMLDivElement>(null);

  const fraction = duration > 0 ? time / duration : 0;
  const impactFraction = impactTime == null || duration <= 0 ? null : impactTime / duration;

  const seek = (clientX: number) => {
    const track = trackRef.current;
    if (!track || duration <= 0) return;
    const rect = track.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * duration;
    setTime(next);
  };

  return (
    <div className={`absolute right-4 bottom-4 z-20 transition-[left] duration-200 ease-in-out ${panelOpen ? "left-[416px]" : "left-[76px]"}`}>
      <div className="rounded-2xl border border-white/10 bg-[#071433]/80 px-4 py-3 text-white shadow-lg backdrop-blur-md">
        <div className="mb-1 flex items-center gap-3">
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={togglePlay}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-900"
          >
            {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>
          <span className="w-10 text-sm tabular-nums">{formatClock(time)}</span>
          <span className="flex-1 text-center text-sm tabular-nums text-white/90">
            {impactTime == null ? "No impact event in this file" : formatRelative(time, impactTime)}
          </span>
          <span className="w-10 text-right text-sm tabular-nums text-white/70">{formatClock(duration)}</span>
        </div>

        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Reconstruction time"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Number(time.toFixed(2))}
          className="relative h-8 cursor-pointer touch-none select-none"
          onPointerDown={(event) => {
            setScrubbing(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            seek(event.clientX);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            seek(event.clientX);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            setScrubbing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") setTime(time + (event.shiftKey ? 1 : 0.1));
            if (event.key === "ArrowLeft") setTime(time - (event.shiftKey ? 1 : 0.1));
            if (event.key === "Home") setTime(0);
            if (event.key === "End") setTime(duration);
          }}
        >
          <div className="absolute top-1/2 right-0 left-0 h-1.5 -translate-y-1/2 rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white" style={{ width: `${fraction * 100}%` }} />
          </div>
          {impactFraction != null && (
            <div
              className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 bg-red-400"
              style={{ left: `${impactFraction * 100}%` }}
              title="Impact"
            />
          )}
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-900 bg-white shadow"
            style={{ left: `${fraction * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
