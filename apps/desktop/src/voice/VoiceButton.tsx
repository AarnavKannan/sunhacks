import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { AlertCircle, ArrowDown, Loader2, Mic, MicOff, Square, X } from "lucide-react";
import { voiceController } from "./controller";
import type { VoiceSink, VoiceSnapshot } from "./types";

export type VoiceButtonProps = {
  /** The finished, cleaned-up transcript of one dictation. Not called when nothing was heard. */
  onTranscript: (text: string) => void;
  /**
   * The text so far while listening (the whole dictation, not a delta), then "" when the
   * dictation ends or is canceled. Omit it to skip live decoding.
   */
  onPartial?: (text: string) => void;
  disabled?: boolean;
  className?: string;
};

/** The shared dictation state, for anything else that wants to show it. */
export function useVoiceState(): VoiceSnapshot {
  const controller = voiceController();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

const RING_RADIUS = 14;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Microphone button for a chat composer. Click to dictate hands-free (click again to stop),
 * or press and hold to talk and release to stop. Esc cancels.
 */
export function VoiceButton({ onTranscript, onPartial, disabled = false, className = "" }: VoiceButtonProps): JSX.Element {
  const controller = voiceController();
  const state = useVoiceState();
  const callbacks = useRef({ onTranscript, onPartial });
  useEffect(() => {
    callbacks.current = { onTranscript, onPartial };
  });

  const wantsPartials = Boolean(onPartial);
  const sink = useMemo<VoiceSink>(
    () => ({
      onTranscript: (text) => callbacks.current.onTranscript(text),
      ...(wantsPartials ? { onPartial: (text: string) => callbacks.current.onPartial?.(text) } : {}),
    }),
    [wantsPartials],
  );

  useEffect(() => controller.addDefaultSink(sink), [controller, sink]);
  useEffect(() => {
    if (disabled && controller.isActive(sink)) controller.cancel();
  }, [controller, disabled, sink]);

  const [hovered, setHovered] = useState(false);
  const [flashError, setFlashError] = useState(false);
  useEffect(() => {
    if (state.view !== "error") return;
    setFlashError(true);
    const timer = setTimeout(() => setFlashError(false), 4000);
    return () => clearTimeout(timer);
  }, [state.view, state.error]);

  const { view } = state;
  const inactive = disabled || view === "unavailable";
  const listening = view === "listening";
  const showTooltip = hovered || (view === "error" && flashError);

  const press = () => {
    if (!inactive) controller.press(sink, "pointer");
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // Keep focus (and the caret) in the composer's text box.
    event.preventDefault();
    if (inactive) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Not capturable (synthetic event): the release still arrives on this button.
    }
    press();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    // Space must not reach the app's play/pause shortcut.
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) press();
  };

  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    controller.release();
  };

  const label =
    view === "listening"
      ? "Stop dictation"
      : view === "transcribing"
        ? "Transcribing"
        : view === "needs-download"
          ? "Download speech model"
          : view === "downloading"
            ? "Cancel speech model download"
            : "Dictate";

  const tone = inactive
    ? "text-neutral-600 cursor-not-allowed"
    : listening
      ? "text-red-400 bg-red-500/15"
      : view === "error"
        ? "text-amber-400 hover:bg-white/10"
        : view === "transcribing" || view === "downloading"
          ? "text-neutral-300 hover:bg-white/10"
          : "text-neutral-400 hover:text-neutral-100 hover:bg-white/10";

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={listening}
        aria-disabled={inactive || undefined}
        aria-describedby={showTooltip ? "voice-button-tooltip" : undefined}
        className={`relative inline-flex h-8 w-8 shrink-0 touch-none select-none items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${tone}`}
        onPointerDown={onPointerDown}
        onPointerUp={() => controller.release()}
        onPointerCancel={() => controller.release()}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        {listening && (
          <>
            {/* Live level: the halo grows with the voice. Browser speech has no level, so it pulses. */}
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-0 rounded-full bg-red-500/25 transition-transform duration-100 ease-out ${
                state.backend === "web-speech" ? "animate-pulse" : ""
              }`}
              style={{ transform: `scale(${1 + state.level * 0.6})` }}
            />
            <span aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
          </>
        )}

        {view === "downloading" && (
          <svg aria-hidden className="pointer-events-none absolute inset-0 -rotate-90" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r={RING_RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={2} />
            <circle
              cx="16"
              cy="16"
              r={RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH * (1 - state.progress)}
              className="text-sky-400 transition-[stroke-dashoffset] duration-150"
            />
          </svg>
        )}

        <span className="relative">
          {view === "unavailable" ? (
            <MicOff size={16} />
          ) : view === "transcribing" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : view === "downloading" ? (
            hovered ? <X size={14} /> : <ArrowDown size={14} />
          ) : view === "error" ? (
            <AlertCircle size={16} />
          ) : listening && state.handsFree ? (
            <Square size={11} fill="currentColor" />
          ) : (
            <Mic size={16} />
          )}
          {view === "needs-download" && (
            <ArrowDown aria-hidden size={9} strokeWidth={3} className="absolute -bottom-1 -right-1.5 text-sky-400" />
          )}
        </span>
      </button>

      {showTooltip && (
        <span
          id="voice-button-tooltip"
          role="tooltip"
          className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 w-max max-w-[260px] rounded-lg bg-neutral-800 px-2.5 py-1.5 text-xs leading-snug text-neutral-100 shadow-lg ring-1 ring-white/10"
        >
          {disabled && view !== "unavailable" ? "Voice input is off right now." : state.hint}
        </span>
      )}
    </span>
  );
}
