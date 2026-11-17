import { useEffect, useRef } from "react";
import { voiceController } from "./controller";
import type { VoiceSink } from "./types";

/** A key held with exact modifiers. `code` is the physical key (KeyboardEvent.code), so it works on any layout. */
export type VoiceHotkey = { code: string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean };

/**
 * Ctrl+M. Space (play/pause) and the arrows (scrub) belong to the app; Alt alone opens the
 * menu bar on Windows and Linux; Cmd+M minimizes on macOS. Ctrl+M has no browser binding.
 */
export const DEFAULT_VOICE_HOTKEY: VoiceHotkey = { code: "KeyM", ctrl: true };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function hotkeyLabel(hotkey: VoiceHotkey = DEFAULT_VOICE_HOTKEY): string {
  const key = hotkey.code.replace(/^Key|^Digit/, "");
  const parts = [hotkey.ctrl && (isMac ? "⌃" : "Ctrl"), hotkey.alt && (isMac ? "⌥" : "Alt"), hotkey.shift && (isMac ? "⇧" : "Shift"), hotkey.meta && (isMac ? "⌘" : "Win")];
  return [...parts.filter(Boolean), key].join(isMac ? "" : "+");
}

const MODIFIER_KEYS: Record<string, keyof VoiceHotkey> = { Control: "ctrl", Alt: "alt", Shift: "shift", Meta: "meta" };

function matches(event: KeyboardEvent, hotkey: VoiceHotkey) {
  return (
    event.code === hotkey.code &&
    event.ctrlKey === Boolean(hotkey.ctrl) &&
    event.altKey === Boolean(hotkey.alt) &&
    event.shiftKey === Boolean(hotkey.shift) &&
    event.metaKey === Boolean(hotkey.meta)
  );
}

export type UseVoiceHotkeyOptions = {
  enabled?: boolean;
  hotkey?: VoiceHotkey;
  /** Where the text goes. Defaults to the most recently mounted VoiceButton's handlers. */
  onTranscript?: (text: string) => void;
  onPartial?: (text: string) => void;
};

/**
 * Push-to-talk on a key, inside this window, like Hex's dictation shortcut: hold it to talk and
 * release to stop, or tap it to dictate hands-free and tap again to stop. Esc cancels.
 * Returns the key's label for hints ("Ctrl+M").
 */
export function useVoiceHotkey({ enabled = true, hotkey = DEFAULT_VOICE_HOTKEY, onTranscript, onPartial }: UseVoiceHotkeyOptions = {}): string {
  const callbacks = useRef({ onTranscript, onPartial });
  useEffect(() => {
    callbacks.current = { onTranscript, onPartial };
  });
  const { code, ctrl, alt, shift, meta } = hotkey;
  const hasOwnSink = Boolean(onTranscript);
  const wantsPartials = Boolean(onPartial);

  useEffect(() => {
    if (!enabled) return;
    const controller = voiceController();
    const bound: VoiceHotkey = { code, ctrl, alt, shift, meta };
    const ownSink: VoiceSink | null = hasOwnSink
      ? {
          onTranscript: (text) => callbacks.current.onTranscript?.(text),
          ...(wantsPartials ? { onPartial: (text: string) => callbacks.current.onPartial?.(text) } : {}),
        }
      : null;
    let held = false;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!matches(event, bound)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || held) return;
      held = true;
      controller.press(ownSink ?? controller.defaultSink, "key");
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!held) return;
      const modifier = MODIFIER_KEYS[event.key];
      if (event.code !== bound.code && !(modifier && bound[modifier])) return;
      held = false;
      controller.release();
    };
    const onBlur = () => {
      if (held) {
        held = false;
        controller.release();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      if (held) controller.release();
    };
  }, [enabled, code, ctrl, alt, shift, meta, hasOwnSink, wantsPartials]);

  return hotkeyLabel(hotkey);
}
