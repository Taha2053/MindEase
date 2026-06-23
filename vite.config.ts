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
          const { background, permissions, ...rest } = base;
          return {
            ...rest,
            permissions: (permissions as string[]).filter(
              (p) => p !== "sidePanel" && p !== "downloads",
            ),
            browser_specific_settings: {
              gecko: {
                id: "mindease@architects.ensit",
                strict_min_version: "109.0",
              },
            },
            content_security_policy: {
              extension_pages:
                "script-src 'self'; object-src 'self'; style-src 'self' 'unsafe-inline';",
            },
            background: {
              scripts: [base.background.service_worker],
              type: "module",
            },
          };
        }
        return base;
      },
      browser: mode === "firefox" ? "firefox" : "chrome",
      watchFilePaths: ["src/**/*.ts", "src/manifest.json"],
      additionalInputs: [
        "src/layer2/onboarding/onboarding.html",
        "src/session/dashboard/dashboard.html",
      ],
    }),
  ],
  test: {
    environment: "node",
  },
}));
