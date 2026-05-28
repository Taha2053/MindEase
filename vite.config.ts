import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";

export default defineConfig(({ mode }) => ({
  // ── Build output ────────────────────────────────────────────────────────────
  build: {
    outDir: mode === "firefox" ? "dist/firefox" : "dist/chrome",
    emptyOutDir: true,
  },

  // ── Path aliases ─────────────────────────────────────────────────────────────
  resolve: {
    alias: {
      "@": "/src",
    },
  },

  // ── Extension plugin ─────────────────────────────────────────────────────────
  plugins: [
    webExtension({
      // Points to our manifest; the plugin injects browser-specific fields
      manifest: () => {
        const base = require("./src/manifest.json");
        if (mode === "firefox") {
          return {
            ...base,
            // Firefox requires a browser_specific_settings block
            browser_specific_settings: {
              gecko: {
                id: "mindease@architects.ensit",
                strict_min_version: "109.0",
              },
            },
          };
        }
        return base;
      },
      browser: mode === "firefox" ? "firefox" : "chrome",
      // Enables HMR during development
      watchFilePaths: ["src/**/*.ts", "src/manifest.json"],
    }),
  ],
}));
