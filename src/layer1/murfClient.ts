const MURF_API_URL = "https://api.murf.ai/v1/speech/generate";

export async function generateSpeech(
  text: string,
  voiceId = "Natalie",
  locale = "en-US",
): Promise<string> {
  const apiKey = import.meta.env.VITE_MURF_API_KEY;

  const res = await fetch(MURF_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({ text, voiceId, locale }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Murf API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  if (!data.audioFile) throw new Error("Murf API: missing audioFile in response");
  return data.audioFile as string;
}
