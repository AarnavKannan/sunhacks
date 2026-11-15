const { app, BrowserWindow, ipcMain } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const isDev = !app.isPackaged;
const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"]);

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

ipcMain.handle("footage:stage", async (_event, filePaths) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error("Select at least one video file.");
  }

  const incidentId = crypto.randomUUID();
  const incidentDir = path.join(app.getPath("userData"), "incidents", incidentId);
  const sourceDir = path.join(incidentDir, "sources");
  await fs.promises.mkdir(sourceDir, { recursive: true });

  const videos = [];
  try {
    for (const [index, rawPath] of filePaths.entries()) {
      if (typeof rawPath !== "string" || !path.isAbsolute(rawPath)) {
        throw new Error("A selected video path is invalid.");
      }

      const sourcePath = path.resolve(rawPath);
      const sourceStat = await fs.promises.stat(sourcePath);
      const extension = path.extname(sourcePath).toLowerCase();
      if (!sourceStat.isFile() || !videoExtensions.has(extension)) {
        throw new Error(`Unsupported video file: ${path.basename(sourcePath)}`);
      }

      const originalName = path.basename(sourcePath);
      const fileStem = path.basename(sourcePath, extension).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 160);
      const storedName = `${String(index + 1).padStart(2, "0")}-${fileStem || "video"}${extension}`;
      const storedPath = path.join(sourceDir, storedName);
      await fs.promises.copyFile(sourcePath, storedPath, fs.constants.COPYFILE_EXCL);

      videos.push({
        fileName: originalName,
        storedName,
        sizeBytes: sourceStat.size,
        sha256: await hashFile(storedPath),
      });
    }

    const manifest = {
      schemaVersion: 1,
      incidentId,
      createdAt: new Date().toISOString(),
      processingStatus: "staged",
      videos,
    };
    await fs.promises.writeFile(
      path.join(incidentDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: "wx" },
    );

    return {
      incidentId,
      videos: videos.map(({ fileName, sizeBytes, sha256 }) => ({ fileName, sizeBytes, sha256 })),
    };
  } catch (error) {
    await fs.promises.rm(incidentDir, { recursive: true, force: true });
    throw error;
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "Reconstruct",
    backgroundColor: "#0a2378",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
