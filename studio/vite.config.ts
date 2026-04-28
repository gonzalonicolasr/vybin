import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the Tauri shell.
// - host 1420 is the Tauri default dev server port.
// - clearScreen: false so Tauri's logs aren't wiped on every reload.
// - strictPort: true so Tauri can rely on a fixed port.
// - HMR over the LAN is disabled in production builds.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    minify: "esbuild",
    sourcemap: false,
  },
});
