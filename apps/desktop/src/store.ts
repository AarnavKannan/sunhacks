import { create } from "zustand";

export type SceneId = "intersection" | "parking";

type SceneState = {
  sceneId: SceneId;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  setSceneId: (sceneId: SceneId) => void;
  setCurrentTime: (currentTime: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
};

export const useSceneStore = create<SceneState>((set) => ({
  sceneId: "intersection",
  currentTime: 3.8,
  duration: 12,
  isPlaying: false,
  setSceneId: (sceneId) => set({
    sceneId,
    currentTime: 3.8,
    duration: sceneId === "parking" ? 8.4 : 12,
    isPlaying: false,
  }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
}));
