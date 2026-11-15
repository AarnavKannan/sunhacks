import { SidePanel } from "@/components/SidePanel";
import { Timeline } from "@/components/Timeline";
import { Viewport } from "@/components/Viewport";
import { ingestFiles } from "@/lib/ingest";
import { useAppStore } from "@/store/useAppStore";
import { useEffect, useState } from "react";

export function App() {
  const panelOpen = useAppStore((state) => state.panelOpen);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let depth = 0;

    const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes("Files");

    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragOver(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        setDragOver(false);
      }
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      depth = 0;
      setDragOver(false);
      if (event.dataTransfer?.files?.length) void ingestFiles(event.dataTransfer.files);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const store = useAppStore.getState();
      if (event.key === " ") {
        event.preventDefault();
        store.togglePlay();
      } else if (event.key === "ArrowRight") {
        store.setTime(store.time + (event.shiftKey ? 1 : 0.1));
      } else if (event.key === "ArrowLeft") {
        store.setTime(store.time - (event.shiftKey ? 1 : 0.1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Viewport />
      {panelOpen && <SidePanel dragOver={dragOver} />}
      <Timeline />
    </div>
  );
}
