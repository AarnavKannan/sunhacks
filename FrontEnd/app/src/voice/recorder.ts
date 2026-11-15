/**
 * Microphone capture for the local backend: mono Float32 PCM, ideally at 16 kHz.
 *
 * After a capture the microphone stays open for LINGER_MS so the next dictation starts at
 * once, and while it is open the last PRE_ROLL_MS of audio is kept and put in front of the next
 * capture, so a word spoken right as the button goes down isn't clipped. Both follow Hex's
 * "keep mic open after dictating" and 450 ms pre-roll (https://github.com/anomalyco/hex, MIT).
 */

const TARGET_RATE = 16000;
const PRE_ROLL_MS = 450;
const LINGER_MS = 20000;

const WORKLET = `
class VoiceCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(1600); this.length = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const take = Math.min(channel.length - offset, this.buffer.length - this.length);
        this.buffer.set(channel.subarray(offset, offset + take), this.length);
        this.length += take;
        offset += take;
        if (this.length === this.buffer.length) {
          this.port.postMessage(this.buffer);
          this.buffer = new Float32Array(1600);
          this.length = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("voice-capture", VoiceCapture);
`;

export class MicError extends Error {}

function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access is blocked. Allow it in your system settings.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone found.";
  if (name === "NotReadableError") return "The microphone is in use by another app or unavailable.";
  return "Couldn't start the microphone.";
}

export class MicRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private opening: Promise<void> | null = null;
  private chunks: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private preRollLength = 0;
  private recording = false;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private peak = 0;

  /** RMS level of each ~100 ms block while recording. */
  onLevel: ((rms: number) => void) | null = null;

  get sampleRate(): number {
    return this.context?.sampleRate ?? TARGET_RATE;
  }

  /** The loudest block RMS since the capture started. */
  get peakLevel(): number {
    return this.peak;
  }

  private async open(): Promise<void> {
    if (this.context && this.stream?.active) return;
    if (!this.opening) {
      this.opening = this.openOnce().finally(() => {
        this.opening = null;
      });
    }
    return this.opening;
  }

  private async openOnce(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new MicError("This window can't use the microphone.");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      throw new MicError(micErrorMessage(error));
    }
    let context: AudioContext;
    try {
      context = new AudioContext({ sampleRate: TARGET_RATE });
    } catch {
      context = new AudioContext();
    }
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "voice-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (event: MessageEvent<Float32Array>) => this.onBlock(event.data);
    source.connect(node);
    // A track that ends underneath us (device unplugged) closes everything.
    stream.getAudioTracks().forEach((track) => track.addEventListener("ended", () => this.close()));
    this.context = context;
    this.stream = stream;
    this.node = node;
  }

  private onBlock(block: Float32Array) {
    if (this.recording) {
      this.chunks.push(block);
      let sum = 0;
      for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
      const rms = Math.sqrt(sum / block.length);
      this.peak = Math.max(this.peak, rms);
      this.onLevel?.(rms);
      return;
    }
    this.preRoll.push(block);
    this.preRollLength += block.length;
    const keep = (PRE_ROLL_MS / 1000) * this.sampleRate;
    while (this.preRoll.length > 1 && this.preRollLength - this.preRoll[0].length >= keep) {
      this.preRollLength -= this.preRoll.shift()!.length;
    }
  }

  /** Starts a capture. Rejects with a MicError carrying a plain message. */
  async start(): Promise<void> {
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    await this.open();
    await this.context?.resume();
    // Warm, this is the pre-roll; cold, it is whatever arrived since the mic opened, which is
    // all after the press.
    this.chunks = [...this.preRoll];
    this.preRoll = [];
    this.preRollLength = 0;
    this.peak = 0;
    this.recording = true;
  }

  /** The audio so far, without ending the capture. */
  snapshot(): Float32Array {
    return concat(this.chunks);
  }

  /** Ends the capture and returns its audio. The microphone lingers open for the next one. */
  stop(): Float32Array {
    this.recording = false;
    const audio = concat(this.chunks);
    this.chunks = [];
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = setTimeout(() => this.close(), LINGER_MS);
    return audio;
  }

  /** Releases the microphone now. */
  close() {
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    this.recording = false;
    this.chunks = [];
    this.preRoll = [];
    this.preRollLength = 0;
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close().catch(() => {});
    this.node = null;
    this.stream = null;
    this.context = null;
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
