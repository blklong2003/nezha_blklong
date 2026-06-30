import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const appVersion = readFileSync(new URL("./.version", import.meta.url), "utf-8").trim();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  root: "src/remote",
  base: "./",
  build: {
    outDir: "../../dist-remote",
    emptyOutDir: true,
    target: "es2020",
    codeSplitting: false,
  },

  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
});