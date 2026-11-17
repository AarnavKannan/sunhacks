import type { SceneHandle } from "@/scene/mountScene";

/** The mounted 3D scene, shared by the viewport (which owns it) and the assistant controller. */
let active: SceneHandle | null = null;
const waiters: ((handle: SceneHandle) => void)[] = [];

export function setActiveScene(handle: SceneHandle | null) {
  active = handle;
  if (handle) for (const resolve of waiters.splice(0)) resolve(handle);
}

export function getActiveScene() {
  return active;
}

/** Resolves once the viewport has mounted the scene (it mounts at startup, before any tool call). */
export function whenSceneReady(timeoutMs = 10_000): Promise<SceneHandle> {
  if (active) return Promise.resolve(active);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The 3D view isn't ready yet. Try again in a moment.")), timeoutMs);
    waiters.push((handle) => {
      clearTimeout(timer);
      resolve(handle);
    });
  });
}
