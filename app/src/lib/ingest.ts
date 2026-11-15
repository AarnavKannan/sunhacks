import { isSplatFile } from "@/lib/splatFiles";
import { useAppStore } from "@/store/useAppStore";

export async function ingestFiles(fileList: FileList | File[]) {
  const files = [...fileList];
  const videos: { name: string; size: number }[] = [];

  for (const file of files) {
    if (isSplatFile(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      useAppStore.getState().addSplatScene({ fileName: file.name, bytes });
    } else {
      videos.push({ name: file.name, size: file.size });
    }
  }

  if (videos.length > 0) {
    useAppStore.getState().addUploads(videos);
    useAppStore.getState().setPanelOpen(true);
  }
}
