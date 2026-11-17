import { useRef } from "react";

/**
 * A thin vertical strip on a panel edge that resizes the panel sideways (never vertically).
 * `onResize` gets the new width; `edge` says which side of the panel the strip sits on, so
 * dragging toward the panel's outside makes it wider.
 */
export function ResizeHandle({
  edge,
  width,
  onResize,
  onResizingChange,
  label,
  dark = false,
}: {
  edge: "left" | "right";
  width: number;
  onResize: (width: number) => void;
  onResizingChange?: (resizing: boolean) => void;
  label: string;
  dark?: boolean;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);

  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onResizingChange?.(false);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title={`${label} (drag sideways)`}
      className={`group absolute inset-y-0 z-40 w-2 cursor-col-resize touch-none select-none ${edge === "right" ? "-right-1" : "-left-1"}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width };
        // Keep the ↔ cursor even when the pointer runs ahead of the strip.
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        onResizingChange?.(true);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        const dx = event.clientX - start.current.x;
        onResize(start.current.width + (edge === "right" ? dx : -dx));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onResize(Number.NaN)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;
        const grow = edge === "right" ? "ArrowRight" : "ArrowLeft";
        const shrink = edge === "right" ? "ArrowLeft" : "ArrowRight";
        if (event.key === grow) onResize(width + step);
        else if (event.key === shrink) onResize(width - step);
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        className={`mx-auto h-full w-0.5 transition-colors ${
          dark ? "group-hover:bg-white/30 group-focus-visible:bg-white/50" : "group-hover:bg-[#1a73e8]/50 group-focus-visible:bg-[#1a73e8]"
        }`}
      />
    </div>
  );
}
