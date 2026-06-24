/* ─── MindEase - Layer 1: Mistral API Client ───
     Direct fetch() calls to Mistral AI API.
     Uses mistral-small-latest model.
  ───────────────────────────────────────────────────────────── */

import type { TransformationParams } from "@/types";

const MISTRAL_API_KEY = import.meta.env.VITE_MISTRAL_API_KEY as string;

async function callMistral(prompt: string): Promise<string> {
  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: "mistral-small-latest",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.3,
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

/* ─── Web Content Transformation ─── */

export async function transformWebContent(
  content: string,
  profile: TransformationParams,
): Promise<string> {
  const prompt = `You are an accessibility tool. Simplify this educational webpage content for a student.
Profile: chunkSize=${profile.chunkSize}, simplificationLevel=${profile.simplificationLevel}, 
useVisualAnchors=${profile.useVisualAnchors}, summaryFrequency=${profile.summaryFrequency}.
Rules:
- Split into labeled chunks using [CHUNK 1], [CHUNK 2], etc. based on chunkSize (small=150 words, medium=300, large=500)
- Simplification level 1=light edit, 2=simpler vocab, 3=plain language
- If useVisualAnchors=true, add a [CONCEPT: ...] tag before each key idea
- If summaryFrequency=high, add [SUMMARY: ...] after every chunk
- Each chunk must cover one coherent topic
- Add --- between chunks for clear separation
- IMPORTANT: Output any math formulas or equations using LaTeX with $...$ for inline and $$...$$ for display math. For example: $E = mc^2$, $$\psi(x) = \sqrt{2}\sin(n\pi x / L)$$
Return clean readable text only. Content: ${content}`;

  return callMistral(prompt);
}

/* ─── PDF Content Transformation ─── */

export async function transformPDF(
  content: string,
  profile: TransformationParams,
): Promise<string> {
  const prompt = `You are an accessibility tool. Transform this PDF educational content for a student with specific cognitive needs.
Profile: chunkSize=${profile.chunkSize}, simplificationLevel=${profile.simplificationLevel},
useVisualAnchors=${profile.useVisualAnchors}, summaryFrequency=${profile.summaryFrequency}.
Rules:
- Break into labeled chunks: [CHUNK 1], [CHUNK 2], etc.
- Each chunk: max 3 sentences, grade 8 language, one clear idea
- Simplification level 1=light edit, 2=simpler vocab, 3=plain language
- If useVisualAnchors=true, add [CONCEPT: ...] before key ideas
- If summaryFrequency=high, add [SUMMARY: ...] after every chunk
- IMPORTANT: Output any math formulas or equations using LaTeX with $...$ for inline and $$...$$ for display math
Be warm, clear, encouraging. Content: ${content}`;

  return callMistral(prompt);
}

/* ─── Video Transcript Transformation ─── */

export async function transformVideoTranscript(
  transcript: string,
  profile: TransformationParams,
): Promise<string> {
  const wordsPerCaption =
    profile.captionSpeed === "slow" ? 6 :
    profile.captionSpeed === "normal" ? 10 : 15;

  const prompt = `Break this video transcript into adaptive captions.
captionSpeed=${profile.captionSpeed} (${wordsPerCaption} words per caption).
Format each caption as: [MM:SS] caption text
Add [CONCEPT: ...] markers for key terms.
Transcript: ${transcript}`;

  return callMistral(prompt);
}

/* ─── Lecture Transformation ─── */

export async function transformLecture(
  text: string,
  profile: TransformationParams,
): Promise<string> {
  const prompt = `Summarize this live lecture segment in real time for a student with specific cognitive needs.
Profile: simplificationLevel=${profile.simplificationLevel}, useVisualAnchors=${profile.useVisualAnchors}.
Format:
NOW COVERING: ... | KEY POINTS: ... | WATCH FOR: ... 
Keep it under 60 words.
Lecture text: ${text}`;

  return callMistral(prompt);
}
