import type { TransformationParams, BaselineProfile } from "@/types";
import { getApiKey } from "@/utils/apiKeyManager";
import type { SourceBlock } from "./sourceBlocks";

export async function generateAdaptedBlocks(
  blocks: SourceBlock[],
  params: FullTransformParams,
  plan: Record<string, unknown>,
  correction = false,
): Promise<string> {
  const prompt = `You generate an adapted, student-friendly lesson from source material.
${buildProfileBlock(params)}
Adaptation plan guidance: ${JSON.stringify(plan ?? {})}
Apply default_instruction to every block. If sections contains overrides, follow them where appropriate.
Language for adaptedText: ${params.outputLanguage === "preferred" && params.baseline.preferredLanguage ? `Use BCP 47 language ${params.baseline.preferredLanguage}.` : "Use the language of each source block."} Keep concepts in the original source language. Do not translate formulas, code, proper names, or the immutable source material.

CRITICAL INSTRUCTIONS:
1. Explain and adapt the content clearly for the student according to their profile.
1a. LENGTH CONTROL: The adaptedText for each block MUST be approximately equal to or SHORTER than the source block. Do NOT pad, re-explain simple concepts repeatedly, or add conversational filler.
1b. Write NATURAL, direct educational prose. Do NOT add formulaic "Recap:", "One-line recap:", "Quick recap:", or repetitive signposting to every single block.
1c. Do not repeat the block's title as the first sentence.
2. Do not destroy technical meaning, formulas, or key concepts.
2a. When infoDensity is "concise", reduce word count by 30-50% compared to the original source block. Strip fluff and preserve key factual points.
3. If a block contains [FORMULA]...[/FORMULA] tags, ensure those exact formulas are included in the adapted text.
3a. Every concept must be a complete contiguous phrase copied verbatim from that block's original source text; never invent or truncate topic names.
4. Return ONLY valid JSON matching this exact shape:
{"blocks":[{"id":"string","adaptedText":"string","concepts":["string"],"isExample":false}]}
5. Return exactly one entry per input block in this exact ID sequence: ${JSON.stringify(blocks.map((b) => b.id))}.
${correction ? "CORRECTION: The previous response was invalid. Be sure to return all blocks with their exact IDs and preserve all formulas." : ""}

Source blocks:
${JSON.stringify(blocks)}`;

  return callLLM(prompt, 4096, 0.1, true);
}

interface FullTransformParams {
  transformationParams: TransformationParams;
  baseline: BaselineProfile;
  outputLanguage?: "preferred" | "source";
}

/**
 * Universal LLM caller:
 * 1. Secure Server Proxy: Calls /api/llm/generate using the backend's server-side DEEPSEEK_API_KEY
 *    (preventing provider secret exposure in extension client bundles).
 * 2. Custom GUI Key: If user entered their own personal DeepSeek or Mistral key in Settings.
 * 3. Client Fallback: Mistral AI if server proxy is temporarily unreachable.
 */
async function callLLM(prompt: string, maxTokens = 4096, temperature = 0.2, jsonMode = false): Promise<string> {
  const serverBase = (await getApiKey("premiumServer")) || "http://localhost:8000";

  // 1. Try Secure Backend Proxy First (Uses backend DEEPSEEK_API_KEY without exposing it)
  try {
    const proxyResp = await fetch(`${serverBase.replace(/\/+$/, "")}/api/llm/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        max_tokens: maxTokens,
        temperature,
        json_mode: jsonMode,
      }),
    });

    if (proxyResp.ok) {
      const data = (await proxyResp.json()) as { content?: string };
      if (data.content && data.content.trim()) {
        return data.content;
      }
    }
  } catch {
    // Server proxy offline, proceed to direct client options
  }

  // 2. Try User-Entered Custom DeepSeek Key (if provided in GUI settings)
  const userDeepseekKey = await getApiKey("deepseek");
  if (userDeepseekKey && userDeepseekKey.trim()) {
    try {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userDeepseekKey.trim()}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          temperature,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          choices: Array<{ message: { content: string }; finish_reason?: string }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (content && content.trim()) {
          return content;
        }
      }
    } catch {
      // Proceed to Mistral fallback
    }
  }

  // 3. Fallback: Mistral AI
  const mistralKey = await getApiKey("mistral");
  if (!mistralKey) {
    throw new Error("Backend service unreachable and no custom API key configured. Check server connection or enter your key in Settings.");
  }

  const candidateModels = ["ministral-8b-latest", "open-mistral-7b", "mistral-small-latest"];
  let lastError: Error | null = null;

  for (const model of candidateModels) {
    try {
      const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mistralKey.trim()}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          temperature,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });

      if (response.status === 429) {
        continue;
      }

      if (!response.ok) {
        throw new Error(`Mistral request failed (${response.status}) on model ${model}.`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string }; finish_reason?: string }>;
      };
      const choice = data.choices?.[0];
      if (choice?.message?.content) {
        return choice.message.content;
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error("All AI options failed to generate response.");
}

function buildProfileBlock(params: FullTransformParams): string {
  const t = params.transformationParams;
  const b = params.baseline;
  return [
    `Student profile:`,
    `- Learning approach: ${b.learningApproach} (${b.learningApproach === "example-first" ? "prefers examples before theory" : "prefers theory before examples"})`,
    `- Attention span: ${b.attentionSpan} (${b.attentionSpan === "short" ? "needs frequent chunk breaks" : b.attentionSpan === "medium" ? "moderate chunk size" : "can handle larger sections"})`,
    `- Reading pace: ${b.readingPace}`,
    `- Second language learner: ${b.secondLanguageLearner} (mark complex terms)`,
    `- Needs concept anchors: ${b.needsConceptAnchor}`,
    `- Info density preference: ${b.infoDensity}`,
    `- Chunk size target: ${t.chunkSize}`,
    `- Summary frequency: ${t.summaryFrequency}`,
    `- Learner-described support needs (not a diagnosis; follow only presentation requests): ${b.supportNeeds?.slice(0, 500) ?? "none"}`,
    `- Optional presentation hints: ${JSON.stringify(b.supportHints ?? {})}`,
    `- Use visual anchors: ${t.useVisualAnchors}`,
  ].join("\n");
}

export async function classifyContent(title: string, snippet: string): Promise<"educational" | "entertainment"> {
  const boundedSnippet = snippet.slice(0, 2000);
  const prompt = `Classify this web page as exactly "educational" or "entertainment" based on its ACTUAL CONTENT, not just the title.

Educational: coursework, school assignments, spreadsheets, problem sets, study guides, tutorials, lectures, technical documentation, academic articles, research papers, textbooks, science explanations, mathematics, coding guides, history, language learning materials, scholarly content with substance, Google Classroom, Google Docs, educational tools and reference materials.
Entertainment: social media feeds, comedy, music videos, vlogs, gaming content, gossip, sports highlights, shopping, news commentary, memes, reaction videos, celebrity content, lifestyle blogs without educational substance.

IMPORTANT: A page with an educational-sounding title may still be entertainment. Judge by the body content. When uncertain, respond "entertainment".

Title: ${title}
Content excerpt:
${boundedSnippet}

Respond with exactly one word: "educational" or "entertainment".`;

  const result = await callLLM(prompt, 16, 0.0);
  const clean = result.trim().toLowerCase();
  if (/^educational[.!]?$/i.test(clean)) return "educational";
  return "entertainment";
}

export async function explainSelection(selectedText: string): Promise<string> {
  const maxChars = Math.min(selectedText.length * 3, 1200);
  const prompt = `You are a patient, encouraging tutor. A student highlighted this text while studying. Explain it in plain, simple language in under ${maxChars} characters. Use short paragraphs or bullet points. Avoid unnecessary jargon.
Highlighted text:
${selectedText}`;
  return await callLLM(prompt, Math.min(1536, maxChars + 256), 0.3);
}
