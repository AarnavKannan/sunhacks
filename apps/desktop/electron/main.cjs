const { app, BrowserWindow, dialog, ipcMain } = require("electron");
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

let mainWindow = null;

// GEMINI_API_KEY (scene reading from footage, and an assistant fallback) and ANTHROPIC_API_KEY
// live in the gitignored packages/assistant/.env during development.
if (isDev) {
  try {
    process.loadEnvFile(path.join(__dirname, "../../../packages/assistant/.env"));
  } catch {
    // No .env: the CLI logins are the main providers anyway.
  }
}

let assistant = null;
let kinematics = null;
try {
  const bundle = require("./assistant.bundle.cjs");
  assistant = bundle.registerAssistant({ ipcMain, getWindow: () => mainWindow });
  kinematics = bundle.registerKinematics({ ipcMain, app });
  // Gemini reads the footage; its analyses and scenes live in the same MongoDB as the kinematics.
  bundle.registerGemini({
    ipcMain,
    getWindow: () => mainWindow,
    db: kinematics.db,
    cacheDir: path.join(app.getPath("userData"), "gemini-tiles"),
  });
} catch (error) {
  console.error("Assistant failed to load. Run `npm run build:assistant`.", error);
  const unavailable = async () => {
    throw new Error("The assistant isn't built. Run `npm run build:assistant` and restart the app.");
  };
  ipcMain.handle("assistant:providers", async () => []);
  ipcMain.handle("assistant:start", unavailable);
  ipcMain.handle("assistant:send", unavailable);
  ipcMain.handle("assistant:interrupt", async () => {});
  ipcMain.handle("gemini:status", async () => ({ configured: false, models: { fast: "", precise: "" } }));
  ipcMain.handle("gemini:analyze", unavailable);
  ipcMain.handle("gemini:save-scene", unavailable);
  ipcMain.handle("gemini:list-scenes", async () => []);
}

ipcMain.handle("export:save", async (_event, bytes, fileName) => {
  if (!(bytes instanceof Uint8Array) || typeof fileName !== "string") throw new Error("Nothing to save.");
  const safeName = path.basename(fileName).replace(/[<>:"/\|?*\x00-\x1f]/g, "_") || "reconstruction.mp4";
  const options = {
    title: "Save exported video",
    defaultPath: path.join(app.getPath("videos"), safeName),
    filters: [{ name: "Video", extensions: [path.extname(safeName).slice(1) || "mp4"] }],
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  await fs.promises.writeFile(result.filePath, bytes);
  return result.filePath;
});

try {
  require("./voice.cjs").register({ ipcMain, app, getWindow: () => mainWindow });
} catch (error) {
  console.error("Voice transcription failed to register", error);
}

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

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (isDev) {
    // Surface renderer warnings and errors in the terminal that runs `npm start`.
    win.webContents.on("console-message", (event) => {
      if (event.level === "warning" || event.level === "error") console.log(`[renderer ${event.level}] ${event.message}`);
    });
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(createWindow);

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  // Close the CLIs and flush the kinematics database to disk before exiting.
  quitting = true;
  event.preventDefault();
  const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
  void Promise.race([Promise.allSettled([assistant?.dispose(), kinematics?.dispose()]), timeout]).finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
