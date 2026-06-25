interface OcrParsedResult {
  FileParseExitCode: number;
  ParsedText: string | null;
  ErrorMessage: string | null;
  ErrorDetails: string | null;
}

interface OcrResponse {
  ParsedResults: OcrParsedResult[];
  OCRExitCode: number;
  IsErroredOnProcessing: boolean;
  ErrorMessage: string | null;
  ErrorDetails: string | null;
  ProcessingTimeInMilliseconds: string;
}

const OCR_API_KEY = import.meta.env.VITE_OCR_SPACE_API_KEY as string | undefined;
const OCR_BASE = "https://api.ocr.space/parse/image";

async function ocrRequest(formField: string, value: string, language: string): Promise<string> {
  if (!OCR_API_KEY) {
    throw new Error("[OcrClient] VITE_OCR_SPACE_API_KEY is not set");
  }

  const body = new URLSearchParams({
    [formField]: value,
    language,
    isOverlayRequired: "false",
  });

  const res = await fetch(OCR_BASE, {
    method: "POST",
    headers: {
      apikey: OCR_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`[OcrClient] Request failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as OcrResponse;

  if (data.IsErroredOnProcessing || data.OCRExitCode >= 3) {
    throw new Error(
      `[OcrClient] OCR failed: ${data.ErrorMessage ?? "Unknown error"} ${data.ErrorDetails ?? ""}`,
    );
  }

  const texts = data.ParsedResults
    .filter((r) => r.FileParseExitCode === 1 && r.ParsedText)
    .map((r) => r.ParsedText!.trim())
    .filter(Boolean);

  if (texts.length === 0) {
    throw new Error("[OcrClient] No text found in image");
  }

  return texts.join("\n\n");
}

export function ocrImageUrl(imageUrl: string, language = "eng"): Promise<string> {
  return ocrRequest("url", imageUrl, language);
}

export function ocrImageBase64(base64Image: string, language = "eng"): Promise<string> {
  return ocrRequest("base64Image", base64Image, language);
}
