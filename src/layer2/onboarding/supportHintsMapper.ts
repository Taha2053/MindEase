/**
 * supportHintsMapper.ts
 *
 * Maps a learner's free-text support-needs description to an allowlisted
 * set of boolean presentation hints via the project's LLM backend.
 *
 * - Never infers a diagnosis.
 * - Only returns flags from the explicit allowlist; unknown flags are dropped.
 * - Caller always stores the raw `supportNeeds` text regardless of success.
 */

import { getApiKey } from "@/utils/apiKeyManager";
import type { SupportHints } from "@/types";

const ALLOWED_KEYS: Record<keyof SupportHints, true> = {
  largerText: true,
  reducedMotion: true,
  readAloud: true,
  shortSections: true,
  visualAnchors: true,
};

const SYSTEM_PROMPT = `You are a presentation-accessibility mapper for a learning tool.
Given a learner's self-description of their support needs, respond with ONLY a JSON object
containing boolean flags from this exact set:

  largerText      – user benefits from larger or more readable text
  reducedMotion   – user is sensitive to animations or motion
  readAloud       – user benefits from text-to-speech / audio reading
  shortSections   – user benefits from shorter content sections
  visualAnchors   – user benefits from diagrams, icons, or visual cues

Rules:
- Set a flag to true ONLY if the description clearly implies it.
- Omit flags that are not supported by the description.
- NEVER diagnose a condition. NEVER add keys outside the set above.
- Return valid JSON only. Example: {"shortSections":true,"readAloud":true}`;

/**
 * Attempt to derive support hints from the user's free-text description.
 * Returns undefined on any failure (network, parse, empty input).
 * The raw description is always preserved by the caller.
 */
export async function mapSupportNeeds(description: string): Promise<SupportHints | undefined> {
  const trimmed = description.trim();
  if (!trimmed) return undefined;

  const prompt = `Learner's self-description:\n"${trimmed}"\n\nRespond with the JSON object only.`;

  let raw: string;
  try {
    raw = await callLLMForHints(prompt);
  } catch {
    return undefined;
  }

  return parseHints(raw);
}

/** Validate and filter LLM response to allowlisted keys. */
function parseHints(raw: string): SupportHints | undefined {
  try {
    // Strip markdown fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;

    const result: SupportHints = {};
    let hasAny = false;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if ((key as keyof SupportHints) in ALLOWED_KEYS && typeof value === "boolean" && value) {
        (result as Record<string, boolean>)[key] = true;
        hasAny = true;
      }
    }
    return hasAny ? result : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Minimal LLM caller matching the project's existing three-tier pattern
 * (server proxy → user DeepSeek key → Mistral fallback).
 * Kept intentionally small; only used for this single mapping task.
 */
async function callLLMForHints(userPrompt: string): Promise<string> {
  const serverBase = (await getApiKey("premiumServer")) || "http://localhost:8000";

  // 1. Server proxy
  try {
    const resp = await fetch(`${serverBase.replace(/\/+$/, "")}/api/llm/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `${SYSTEM_PROMPT}\n\n${userPrompt}`,
        max_tokens: 256,
        temperature: 0.1,
        json_mode: true,
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { content?: string };
      if (data.content?.trim()) return data.content;
    }
  } catch { /* proceed */ }

  // 2. User DeepSeek key
  const dsKey = await getApiKey("deepseek");
  if (dsKey?.trim()) {
    try {
      const resp = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${dsKey.trim()}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 256,
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (content?.trim()) return content;
      }
    } catch { /* proceed */ }
  }

  // 3. Mistral fallback
  const mistralKey = await getApiKey("mistral");
  if (!mistralKey) throw new Error("No LLM backend available");

  for (const model of ["ministral-8b-latest", "open-mistral-7b", "mistral-small-latest"]) {
    try {
      const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mistralKey.trim()}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 256,
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
      });
      if (resp.status === 429) continue;
      if (!resp.ok) throw new Error(`Mistral ${resp.status}`);
      const data = (await resp.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (content?.trim()) return content;
    } catch { /* try next model */ }
  }

  throw new Error("All LLM options failed");
}
