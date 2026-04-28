/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@tauri-apps/api/core": path.resolve(
        __dirname,
        "src/__mocks__/@tauri-apps/api/core.ts",
      ),
      "@tauri-apps/plugin-fs": path.resolve(
        __dirname,
        "src/__mocks__/@tauri-apps/plugin-fs.ts",
      ),
      "@tauri-apps/plugin-store": path.resolve(
        __dirname,
        "src/__mocks__/@tauri-apps/plugin-store.ts",
      ),
      "@tauri-apps/plugin-notification": path.resolve(
        __dirname,
        "src/__mocks__/@tauri-apps/plugin-notification.ts",
      ),
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("test"),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "src-tauri"],
  },
});
