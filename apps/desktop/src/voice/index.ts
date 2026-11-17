/**
 * Push-to-talk dictation. In the desktop app it transcribes on this computer (Parakeet TDT via
 * sherpa-onnx, electron/voice.cjs); in a plain browser it falls back to the Web Speech API, or
 * shows a disabled button when there is none.
 *
 *   <VoiceButton onTranscript={(text) => insert(text)} onPartial={setPreview} />
 *   useVoiceHotkey(); // hold Ctrl+M anywhere in the window; text goes to the mounted VoiceButton
 */
export { VoiceButton, useVoiceState } from "./VoiceButton";
export type { VoiceButtonProps } from "./VoiceButton";
export { useVoiceHotkey, hotkeyLabel, DEFAULT_VOICE_HOTKEY } from "./useVoiceHotkey";
export type { VoiceHotkey, UseVoiceHotkeyOptions } from "./useVoiceHotkey";
export type { VoiceSnapshot, VoiceView, VoiceBackend } from "./types";
