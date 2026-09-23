import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const devServerPort = 5205;
const devServerHost = process.env.TAURI_DEV_HOST || "127.0.0.1";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: Object.fromEntries([["@", path.resolve(__dirname, "src")]]),
  },
  clearScreen: false,
  optimizeDeps: {
    entries: ["index.html", "src/main.tsx"],
  },
  server: {
    fs: {
      deny: ["**/src-tauri/**"],
    },
    port: devServerPort,
    strictPort: true,
    host: devServerHost,
    hmr: process.env.TAURI_DEV_HOST
      ? {
          protocol: "ws",
          host: process.env.TAURI_DEV_HOST,
          port: 5173,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
