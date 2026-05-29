/// <reference types="vitest" />
import path from "path";
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
      // During tests, replace webextension-polyfill with a Node-safe stub so
      // its CJS runtime check doesn't throw outside a browser extension context.
      ...(process.env.VITEST
        ? {
            "webextension-polyfill": path.resolve(
              __dirname,
              "src/__mocks__/webextension-polyfill.ts",
            ),
          }
        : {}),
    },
  },

  // ── Extension plugin ─────────────────────────────────────────────────────────
  plugins: [
    webExtension({
      manifest: () => {
        const base = require("./src/manifest.json");
        if (mode === "firefox") {
          return {
            ...base,
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
      watchFilePaths: ["src/**/*.ts", "src/manifest.json"],
    }),
  ],

  // ── Vitest ───────────────────────────────────────────────────────────────────
  test: {
    // Layer 3 modules are pure logic — no browser DOM needed
    environment: "node",
  },
}));
