/* ─── MindEase — Layer 1: Ollama API Client ───
     Direct fetch() calls to local Ollama server.
     No API key required. Uses mistral:7b-instruct model.
  ───────────────────────────────────────────────────────────── */

import type { TransformationParams } from "@/types";

async function callOllama(prompt: string): Promise<string> {
  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "mistral:7b-instruct",
      prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`);
  }

  const data = (await response.json()) as { response: string };
  return data.response;
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
- Split into chunks based on chunkSize (small=150 words, medium=300, large=500)
- Simplification level 1=light edit, 2=simpler vocab, 3=plain language
- If useVisualAnchors=true, add a [CONCEPT: ...] tag before each key idea
- If summaryFrequency=high, add [SUMMARY: ...] after every chunk
Return clean readable text only. Content: ${content}`;

  return callOllama(prompt);
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
Be warm, clear, encouraging. Content: ${content}`;

  return callOllama(prompt);
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

  return callOllama(prompt);
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

  return callOllama(prompt);
}
