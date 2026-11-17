import { useAppStore } from "@/store/useAppStore";
import { Film, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** How far the video may drift from the timeline while playing before it's re-seeked (s). */
const DRIFT = 0.25;

/** The original footage, kept in sync with the timeline (footage time = reconstruction time). */
export function SourceVideo({ url, name }: { url: string; name: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const setLayers = useAppStore((state) => state.setLayers);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      const { time, playing, speed } = useAppStore.getState();
      if (!Number.isFinite(video.duration)) return;
      const target = Math.min(time, video.duration);
      video.playbackRate = speed;
      if (playing && time < video.duration) {
        if (Math.abs(video.currentTime - target) > DRIFT) video.currentTime = target;
        if (video.paused) void video.play().catch(() => {});
      } else {
        if (!video.paused) video.pause();
        if (Math.abs(video.currentTime - target) > 0.02) video.currentTime = target;
      }
    };
    video.addEventListener("loadedmetadata", sync);
    sync();
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.time !== previous.time || state.playing !== previous.playing || state.speed !== previous.speed) sync();
    });
    return () => {
      unsubscribe();
      video.removeEventListener("loadedmetadata", sync);
    };
  }, [url]);

  return (
    <div className="pointer-events-auto w-[340px] overflow-hidden rounded-2xl border border-white/10 bg-black/80 shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-white/85">
        <Film size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={name}>
          Original footage · {name}
        </span>
        <button
          type="button"
          aria-label="Hide the original footage"
          className="rounded-full p-0.5 text-white/70 hover:bg-white/15 hover:text-white"
          onClick={() => setLayers({ sourceVideo: false })}
        >
          <X size={13} />
        </button>
      </div>
      {failed ? (
        <div className="px-3 pb-3 text-xs text-white/70">This video can't be played here.</div>
      ) : (
        <video ref={videoRef} src={url} muted playsInline preload="auto" className="block aspect-video w-full bg-black" onError={() => setFailed(true)} />
      )}
    </div>
  );
}
