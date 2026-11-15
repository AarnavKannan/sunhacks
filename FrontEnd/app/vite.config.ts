import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Pure modules from the assistant package (fast path, tool registry, entity matcher).
      "@assistant": fileURLToPath(new URL("../../packages/assistant/src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // The assistant package and the bundled test footage live outside the app folder.
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  optimizeDeps: {
    include: ["three", "@sparkjsdev/spark"],
  },
});
