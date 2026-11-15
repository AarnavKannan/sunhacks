import { BUILTIN_SCENES, type SceneInfo } from "@/data/scenes";
import { putSplatFile } from "@/lib/splatFiles";
import type { FootageAnalysis } from "@/lib/analyzeFootage";
import { DEFAULT_ENVIRONMENT } from "@/scene/environment";
import { create } from "zustand";

export type UploadItem = {
  id: string;
  name: string;
  size: number;
  file: File;
  status: "queued";
  /** Environment read from the footage; scenes reconstructed from it inherit it. */
  analysis: { state: "analyzing" } | { state: "done"; result: FootageAnalysis } | { state: "failed"; error: string };
};

type Store = {
  scenes: SceneInfo[];
  uploads: UploadItem[];
  selectedId: string;
  time: number;
  duration: number;
  impactTime: number | null;
  playing: boolean;
  scrubbing: boolean;
  panelOpen: boolean;
  search: string;
  cameraResetToken: number;
  selectScene: (id: string) => void;
  setTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlay: () => void;
  setScrubbing: (scrubbing: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  setSearch: (search: string) => void;
  jumpToImpact: () => void;
  resetCamera: () => void;
  addUploads: (files: { id: string; name: string; size: number; file: File }[]) => void;
  setUploadAnalysis: (id: string, analysis: UploadItem["analysis"]) => void;
  removeUpload: (id: string) => void;
  addSplatScene: (file: { fileName: string; bytes: Uint8Array }) => void;
};

const initial = BUILTIN_SCENES[0];

function clampTime(time: number, duration: number) {
  if (!Number.isFinite(time)) return 0;
  return Math.min(duration, Math.max(0, time));
}

export const useAppStore = create<Store>((set, get) => ({
  scenes: BUILTIN_SCENES,
  uploads: [],
  selectedId: initial.id,
  time: initial.startTime,
  duration: initial.duration,
  impactTime: initial.impactTime,
  playing: false,
  scrubbing: false,
  panelOpen: true,
  search: "",
  cameraResetToken: 0,
  selectScene: (id) => {
    const scene = get().scenes.find((item) => item.id === id);
    if (!scene) return;
    set({
      selectedId: id,
      duration: scene.duration,
      impactTime: scene.impactTime,
      time: scene.startTime,
      playing: false,
    });
  },

  setTime: (time) => set({ time: clampTime(time, get().duration) }),

  setPlaying: (playing) => set({ playing }),

  togglePlay: () => {
    const { playing, time, duration } = get();
    if (!playing && time >= duration - 0.05) {
      set({ time: 0, playing: true });
      return;
    }
    set({ playing: !playing });
  },

  setScrubbing: (scrubbing) => set({ scrubbing }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setSearch: (search) => set({ search }),

  jumpToImpact: () => {
    const { impactTime, duration } = get();
    if (impactTime == null) return;
    set({ time: clampTime(impactTime, duration), playing: false });
  },

  resetCamera: () => set((state) => ({ cameraResetToken: state.cameraResetToken + 1 })),

  addUploads: (files) =>
    set((state) => ({
      uploads: [
        ...files.map((file) => ({
          id: file.id,
          name: file.name,
          size: file.size,
          file: file.file,
          status: "queued" as const,
          analysis: { state: "analyzing" as const },
        })),
        ...state.uploads,
      ],
    })),

  setUploadAnalysis: (id, analysis) =>
    set((state) => ({
      uploads: state.uploads.map((item) => (item.id === id ? { ...item, analysis } : item)),
    })),

  removeUpload: (id) =>
    set((state) => ({ uploads: state.uploads.filter((item) => item.id !== id) })),

  addSplatScene: (file) => {
    const id = `splat-${crypto.randomUUID()}`;
    // A splat carries no footage of its own; use the most recently analysed upload, if any.
    const analysed = get().uploads.find((item) => item.analysis.state === "done");
    const environment =
      analysed?.analysis.state === "done" ? analysed.analysis.result.environment : DEFAULT_ENVIRONMENT;
    putSplatFile(id, file);
    const scene: SceneInfo = {
      id,
      title: file.fileName.replace(/\.[^.]+$/, ""),
      location: "Local splat file",
      detail: file.fileName,
      duration: 10,
      impactTime: null,
      startTime: 0,
      kind: "splat",
      vehicles: [],
      environment,
      environmentSource: analysed?.name,
    };
    set((state) => ({ scenes: [scene, ...state.scenes] }));
    get().selectScene(id);
  },
}));
