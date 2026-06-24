import type { TransformationParams, BaselineProfile } from "@/types";

const NVIDIA_API_KEY = import.meta.env.VITE_NVIDIA_API_KEY as string;

const API_BASE = "https://integrate.api.nvidia.com/v1";
const MODEL = "deepseek-ai/deepseek-v4-pro";

interface FullTransformParams {
  transformationParams: TransformationParams;
  baseline: BaselineProfile;
}

async function callLLM(prompt: string, maxTokens = 4096, temperature = 0.3): Promise<string> {
  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature,
      top_p: 0.95,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`NVIDIA LLM error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0].message.content;
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
    `- Use visual anchors: ${t.useVisualAnchors}`,
  ].join("\n");
}

const ANNOTATION_RULES = `
ABSOLUTE RULES (you MUST follow these strictly):
1. NEVER rewrite, rephrase, reword, or summarize any original text. Preserve every sentence, word, formula, and example exactly as written.
2. ONLY insert tags around the original text. Do not remove or change any content.
3. If the text contains math formulas, wrap each formula in [FORMULA] tags: [FORMULA]E = mc^2[/FORMULA]
4. If a section explains a concept via an example, wrap it in [EXAMPLE][/EXAMPLE].
5. Identify key concepts and mark them as [CONCEPT: Concept Name] before the relevant text.
6. For complex or technical terms that might be difficult for the student, wrap each with [DEF: term] before first occurrence.
7. Split the text into logical chunks using [CHUNK 1], [CHUNK 2], etc. at natural breakpoints. Do not split mid-sentence or mid-formula.
8. If summaryFrequency is high or medium, add [SUMMARY: brief summary] after each chunk.
9. If needsConceptAnchor is true, add [CONCEPT: ...] tags before each key idea.

CRITICAL: The student needs to see EVERY piece of information from the original. Your only job is to structure it, not to change it.

IMPORTANT FORMATTING RULE: DO NOT use markdown code blocks (no \`\`\`html or \`\`\`). Return only raw text with tags. No backticks, no fences.`;

export async function transformWebContent(
  content: string,
  params: FullTransformParams,
): Promise<string> {
  const prompt = `You are a content structuring assistant for an adaptive learning tool. Your job is to annotate educational content with structural tags so the tool can present it adaptively based on the student's profile.

${buildProfileBlock(params)}

${ANNOTATION_RULES}

Content to annotate:
${content}`;

  return callLLM(prompt, 4096);
}

export async function transformPDF(
  content: string,
  params: FullTransformParams,
): Promise<string> {
  const prompt = `You are a content structuring assistant for an adaptive learning tool processing a PDF document. Your job is to annotate the educational content with structural tags.

${buildProfileBlock(params)}

${ANNOTATION_RULES}

PDF Content to annotate:
${content}`;

  return callLLM(prompt, 4096);
}

export async function transformVideoTranscript(
  transcript: string,
  params: FullTransformParams,
): Promise<string> {
  const b = params.baseline;
  const t = params.transformationParams;
  const wordsPerCaption =
    t.captionSpeed === "slow" ? 6 :
    t.captionSpeed === "normal" ? 10 : 15;

  const prompt = `You are a caption structuring assistant. Your job is to annotate a video transcript with structural tags so the adaptive tool can present captions aligned with the student's profile.

Student profile:
- Reading pace: ${b.readingPace}
- Second language learner: ${b.secondLanguageLearner}
- Needs concept anchors: ${b.needsConceptAnchor}
- Caption speed: ${t.captionSpeed} (${wordsPerCaption} words per caption)

RULES:
1. NEVER rewrite any transcript text. Preserve every word.
2. Insert [CHUNK] tags at natural pause points (approximately every ${wordsPerCaption} words).
3. Insert [CONCEPT: name] tags before key ideas.
4. Insert [DEF: term] before complex terms.
5. Format: [MM:SS] original caption text (preserve the original text verbatim)
6. Add [FORMULA] tags around any mathematical expressions.

Transcript:
${transcript}`;

  return callLLM(prompt, 4096);
}

export async function classifyContent(
  title: string,
  snippet: string,
): Promise<"educational" | "entertainment"> {
  const prompt = `You are a classifier. Given a webpage title and a text snippet, decide if this page is educational/learning material or entertainment/distraction.

Rules:
- "educational" = tutorials, lectures, courses, documentation, research papers, coding resources, textbooks, news articles, how-to guides, reference materials
- "entertainment" = funny videos, memes, social media feeds, gaming, streaming, music, sports, gossip, pranks, unboxing, reaction videos, vlogs
- If it looks mixed or ambiguous, lean toward what the MAJORITY of the content appears to be
- Only respond with ONE word: "educational" or "entertainment"

Title: ${title}
Snippet: ${snippet.slice(0, 1500)}`;

  const result = await callLLM(prompt, 256, 0.1);
  const clean = result.trim().toLowerCase();
  if (clean.startsWith("educational")) return "educational";
  return "entertainment";
}

export async function transformLecture(
  text: string,
  params: FullTransformParams,
): Promise<string> {
  const prompt = `You are a lecture structuring assistant. Your job is to annotate a live lecture transcript with structural tags.

${buildProfileBlock(params)}

RULES:
1. NEVER rewrite any lecture text. Preserve every word exactly.
2. Insert [CONCEPT: name] tags before key concepts as they are introduced.
3. Insert [EXAMPLE][/EXAMPLE] around examples the lecturer gives.
4. Insert [DEF: term] before technical terms.
5. Add [FORMULA] tags around any mathematical notation.
6. Insert [SUMMARY: brief point] after each major section.
7. Keep it under 60 words per summary. Do not cut or alter the original lecture text.

Lecture text: ${text}`;

  return callLLM(prompt, 2048);
}
