/* ============================================================
   layer1/fluxClient.ts — Flux Image Generation via HuggingFace
   Uses @huggingface/inference to call FLUX.1-dev through fal-ai
   provider. Generates illustrative images from concept text.
   ============================================================ */

import { InferenceClient } from "@huggingface/inference";

const HF_TOKEN = import.meta.env.VITE_HF_TOKEN as string | undefined;

function getClient(): InferenceClient {
  if (!HF_TOKEN) {
    throw new Error("[FluxClient] VITE_HF_TOKEN is not set in environment");
  }
  return new InferenceClient(HF_TOKEN);
}

export interface FluxResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Generate an image for the given concept text using FLUX.1-dev.
 * Returns a Blob and a data URL for display.
 */
export async function generateFluxImage(
  concept: string,
  context?: string,
): Promise<FluxResult> {
  const client = getClient();

  const inputs = context
    ? `${concept} — ${context}`
    : concept;

  // textToImage resolves to the blob overload when called without outputType
  const blob = await (client.textToImage as (...args: unknown[]) => Promise<Blob>)({
    provider: "fal-ai",
    model: "black-forest-labs/FLUX.1-dev",
    inputs,
    parameters: { num_inference_steps: 5 },
  });

  const dataUrl = await blobToDataURL(blob);

  return {
    blob,
    dataUrl,
    width: 1024,
    height: 1024,
  };
}

/**
 * Generate Flux images for multiple concepts in parallel.
 */
export async function generateFluxImages(
  concepts: string[],
): Promise<Map<string, FluxResult>> {
  const map = new Map<string, FluxResult>();
  const results = await Promise.allSettled(
    concepts.map(async (concept) => {
      const result = await generateFluxImage(concept);
      return { concept, result };
    }),
  );

  for (const r of results) {
    if (r.status === "fulfilled") {
      map.set(r.value.concept, r.value.result);
    } else {
      const reason = r.reason;
      const msg = reason?.message || String(reason);
      if (msg.includes("depleted") || msg.includes("credits")) {
        console.warn("[FluxClient] HuggingFace credits depleted. Flux visuals disabled.");
      } else {
        console.warn("[FluxClient] Skipped concept:", msg);
      }
    }
  }

  return map;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
