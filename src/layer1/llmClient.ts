import type { TransformationParams, BaselineProfile } from "@/types";

const MISTRAL_API_KEY = import.meta.env.VITE_MISTRAL_API_KEY as string;

const API_BASE = "https://api.mistral.ai/v1";
const MODEL = "mistral-small-latest";

interface FullTransformParams {
  transformationParams: TransformationParams;
  baseline: BaselineProfile;
}

async function callLLM(prompt: string, maxTokens = 4096, temperature = 0.3): Promise<string> {
  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Mistral error ${response.status}: ${err}`);
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
3. CRITICAL: Identify ALL mathematical expressions and wrap EVERY ONE in [FORMULA] tags. This includes: equations (containing =), logarithms like log2(1/2), sums like ∑, functions like H(X) or I(x), formulas like E = mc^2, any expression with operators (+ - = / * ^), any expression containing symbols like π, ∑, ∫, Δ, any definition of a mathematical value. Wrap each as [FORMULA]expression[/FORMULA].
4. If a section explains a concept via an example, wrap it in [EXAMPLE][/EXAMPLE].
5. ALWAYS identify every distinct concept in the text and mark EACH ONE with [CONCEPT: Concept Name] before the relevant text. For example, if the text introduces "entropy", "mutual information", and "Kullback-Leibler divergence", you MUST wrap each as [CONCEPT: Entropy], [CONCEPT: Mutual Information], [CONCEPT: Kullback-Leibler Divergence]. Do not skip any concepts.
6. For complex or technical terms that might be difficult for the student, wrap each with [DEF: term] before first occurrence.
7. Split the text into logical chunks using [CHUNK 1], [CHUNK 2], etc. at natural breakpoints. Do not split mid-sentence or mid-formula.
8. If summaryFrequency is high or medium, add [SUMMARY: brief summary] after each chunk.

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
- "educational" = tutorials, lectures, courses, documentation, research papers, coding resources, textbooks, how-to guides, reference materials
- "entertainment" = sports websites, football sites, social media (Twitter/X, Instagram, TikTok, Facebook, Reddit, Snapchat, Discord, LinkedIn feeds), memes, pranks, unboxing, reaction videos, vlogs, gossip, streaming
- Social media platforms are ALWAYS entertainment regardless of content.
- Sports and football websites are ALWAYS entertainment.
- For video streaming platforms (YouTube, Vimeo, Dailymotion, etc.): do NOT assume all videos are distractions. Look at the video title in the page title or snippet and judge based on it — a tutorial or lecture is educational, a funny cat video is entertainment.
- If it looks mixed or ambiguous, lean toward what the MAJORITY of the content appears to be.
- Only respond with ONE word: "educational" or "entertainment"

Title: ${title}
Snippet: ${snippet.slice(0, 1500)}`;

  const result = await callLLM(prompt, 256);
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

export async function explainSelection(selectedText: string): Promise<string> {
  const maxChars = Math.max(100, Math.floor(selectedText.length * 0.6));
  const prompt = `You are a tutor. Explain the content below thoroughly but concisely — cover every concept, formula, and detail without being overly verbose. Use LaTeX notation ($$ and $) for any mathematical formulas so they render properly. Do not skip anything. CRITICAL: Your entire response must be ${maxChars} characters or fewer (about 60% of the input length). Be concise.

Content:
${selectedText}`;
  return await callLLM(prompt, Math.min(1536, maxChars + 256), 0.3);
}
