"""Azure AI Speech synthesis. Credentials stay in the backend environment."""

import asyncio
import logging
import html
import os

import httpx

MAX_TEXT_CHARS = 5000
logger = logging.getLogger(__name__)


def speech_config() -> tuple[str, str, str]:
    key = os.getenv("AZURE_SPEECH_KEY", "").strip()
    region = os.getenv("AZURE_SPEECH_REGION", "").strip()
    voice = os.getenv("AZURE_SPEECH_VOICE", "en-US-AvaMultilingualNeural").strip()
    if not key or not region:
        raise RuntimeError("Azure Speech is not configured")
    return key, region, voice


def build_ssml(text: str, voice: str) -> str:
    cleaned = text.strip()
    if not cleaned or len(cleaned) > MAX_TEXT_CHARS:
        raise ValueError(f"Text must contain 1 to {MAX_TEXT_CHARS} characters")
    return (
        '<speak version="1.0" xml:lang="en-US">'
        f'<voice name="{html.escape(voice, quote=True)}">{html.escape(cleaned)}</voice></speak>'
    )


async def synthesize(text: str) -> bytes:
    """Use Azure English neural speech. No gTTS fallback — caller handles errors."""
    key, region, voice = speech_config()
    endpoint = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    body = build_ssml(text, voice).encode()
    timeout = httpx.Timeout(60.0, connect=20.0, pool=20.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(3):
            try:
                response = await client.post(endpoint, content=body, headers={
                    "Ocp-Apim-Subscription-Key": key,
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
                    "User-Agent": "MindEase",
                })
                response.raise_for_status()
                if not response.content:
                    raise RuntimeError("Azure Speech returned empty audio")
                return response.content
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
                transient = status is None or status in (408, 429, 500, 502, 503, 504)
                if attempt == 2 or not transient:
                    raise
                logger.warning("Azure speech retry: error=%s status=%s chars=%d",
                               type(exc).__name__, status, len(text))
                await asyncio.sleep(2 ** attempt)
    raise RuntimeError("Azure Speech synthesis did not complete")
