/** Mirrors VoiceStatus in electron/voice.cjs. */
export type EnginePhase = "missing" | "downloading" | "downloaded" | "loading" | "ready" | "error";

export type EngineStatus = {
  phase: EnginePhase;
  model: { id: string; label: string; bytes: number };
  received: number;
  total: number;
  error?: string;
};

export type TranscribeResult = {
  text: string;
  /** Why nothing was transcribed: "silence", "no-speech" or "not-ready". */
  discarded?: string;
  audioMs: number;
  decodeMs?: number;
};

export type VoiceEvent = { type: "status"; status: EngineStatus };

/** Where a dictation's text goes. */
export type VoiceSink = {
  onTranscript: (text: string) => void;
  onPartial?: (text: string) => void;
};

/** "local": the desktop app's on-device model. "web-speech": a browser's SpeechRecognition. */
export type VoiceBackend = "local" | "web-speech" | "none";

/** What the button shows. */
export type VoiceView =
  | "unavailable"
  | "idle"
  | "needs-download"
  | "downloading"
  | "listening"
  | "transcribing"
  | "error";

export type VoiceSnapshot = {
  backend: VoiceBackend;
  view: VoiceView;
  /** Live input level, 0 to 1, while listening with the local backend. */
  level: number;
  /** A tap started this capture: it keeps listening until the next press. */
  handsFree: boolean;
  /** Download progress, 0 to 1. */
  progress: number;
  /** Tooltip text for the current state. */
  hint: string;
  error?: string;
};
