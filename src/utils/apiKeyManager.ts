/* ============================================================
   utils/apiKeyManager.ts - In-Extension API Key & Server Settings Manager
   Allows freemium users to paste API keys directly into the extension GUI
   without modifying .env files or rebuilding the project.
   Prioritizes browser.storage.local, then falls back to import.meta.env.
   ============================================================ */

import browser from "webextension-polyfill";
import { STORAGE_KEYS, type UserApiKeys } from "@/types";

export type ApiKeyService = "mistral" | "napkin" | "hf" | "ocr" | "premiumServer";

const DEFAULT_PREMIUM_SERVER = "http://localhost:8000";

/**
 * Load all user-configured keys from browser.storage.local.
 */
export async function loadApiKeys(): Promise<UserApiKeys> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEYS.API_KEYS);
    const stored = (result[STORAGE_KEYS.API_KEYS] as UserApiKeys) ?? {};
    return {
      mistralApiKey: stored.mistralApiKey?.trim() || "",
      napkinApiKey: stored.napkinApiKey?.trim() || "",
      hfToken: stored.hfToken?.trim() || "",
      ocrSpaceApiKey: stored.ocrSpaceApiKey?.trim() || "",
      premiumServerUrl: stored.premiumServerUrl?.trim() || (import.meta.env.VITE_PREMIUM_API_URL as string) || DEFAULT_PREMIUM_SERVER,
      updatedAt: stored.updatedAt || 0,
    };
  } catch (err) {
    console.warn("[MindEase] Failed to load API keys from storage:", err);
    return {
      mistralApiKey: "",
      napkinApiKey: "",
      hfToken: "",
      ocrSpaceApiKey: "",
      premiumServerUrl: (import.meta.env.VITE_PREMIUM_API_URL as string) || DEFAULT_PREMIUM_SERVER,
      updatedAt: 0,
    };
  }
}

/**
 * Save API keys directly into browser.storage.local.
 */
export async function saveApiKeys(keys: Partial<UserApiKeys>): Promise<void> {
  try {
    const existing = await loadApiKeys();
    const updated: UserApiKeys = {
      ...existing,
      ...keys,
      updatedAt: Date.now(),
    };
    await browser.storage.local.set({ [STORAGE_KEYS.API_KEYS]: updated });
  } catch (err) {
    console.error("[MindEase] Failed to save API keys to storage:", err);
    throw err;
  }
}

/**
 * Retrieve a specific API key dynamically.
 * Priority: 1. browser.storage.local (GUI input) -> 2. import.meta.env (bundled build env)
 */
export async function getApiKey(service: ApiKeyService): Promise<string | undefined> {
  const stored = await loadApiKeys();

  switch (service) {
    case "mistral":
      return stored.mistralApiKey || (import.meta.env.VITE_MISTRAL_API_KEY as string | undefined);
    case "napkin":
      return stored.napkinApiKey || (import.meta.env.VITE_NAPKIN_API_KEY as string | undefined);
    case "hf":
      return stored.hfToken || (import.meta.env.VITE_HF_TOKEN as string | undefined);
    case "ocr":
      return stored.ocrSpaceApiKey || (import.meta.env.VITE_OCR_SPACE_API_KEY as string | undefined);
    case "premiumServer":
      return stored.premiumServerUrl || (import.meta.env.VITE_PREMIUM_API_URL as string | undefined) || DEFAULT_PREMIUM_SERVER;
    default:
      return undefined;
  }
}

/**
 * Check if the minimum required keys exist for Layer 1 transformation.
 * Mistral AI is the primary requirement.
 */
export async function hasRequiredKeys(): Promise<boolean> {
  const mistral = await getApiKey("mistral");
  return Boolean(mistral && mistral.trim().length > 0);
}

/**
 * Quick validation test for Mistral API Key.
 */
export async function testMistralKey(key: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = key.trim();
  if (!trimmed) {
    return { ok: false, error: "API key cannot be empty" };
  }

  try {
    const res = await fetch("https://api.mistral.ai/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${trimmed}`,
        Accept: "application/json",
      },
    });

    if (res.ok) {
      return { ok: true };
    }
    if (res.status === 401) {
      return { ok: false, error: "Unauthorized (401): Invalid Mistral API key" };
    }
    return { ok: false, error: `Server responded with HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Quick ping test for the MindEase Premium backend service.
 */
export async function testPremiumServer(url: string): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  const cleanUrl = url.trim().replace(/\/+$/, "");
  if (!cleanUrl) {
    return { ok: false, error: "Server URL cannot be empty" };
  }

  try {
    const res = await fetch(`${cleanUrl}/api/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: true, data };
    }
    return { ok: false, error: `Server responded with HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: `Cannot reach server at ${cleanUrl}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
