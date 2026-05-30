/// <reference types="vitest" />
import path from "path";
import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";

export default defineConfig(({ mode }) => ({
  build: {
    outDir: mode === "firefox" ? "dist/firefox" : "dist/chrome",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": "/src",
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
      additionalInputs: [
        "src/layer2/onboarding/onboarding.html",
      ],
    }),
  ],
  test: {
    environment: "node",
  },
}));
