"""Manim voiceover adapter using the same Azure Speech service as the sidebar."""
import asyncio
from pathlib import Path

from manim_voiceover.helper import remove_bookmarks
from manim_voiceover.services.base import SpeechService

from services.azure_speech import speech_config, synthesize


class MindEaseAzureSpeechService(SpeechService):
    def generate_from_text(self, text, cache_dir=None, path=None, **kwargs):
        directory = Path(cache_dir or self.cache_dir)
        _, region, voice = speech_config()
        input_text = remove_bookmarks(text)
        input_data = {
            "input_text": input_text,
            "service": "mindease-azure-speech-v1",
            "voice": voice,
            "region": region,
        }
        cached = self.get_cached_result(input_data, directory)
        if cached is not None:
            return cached
        audio_path = path or self.get_audio_basename(input_data) + ".mp3"
        audio = asyncio.run(synthesize(input_text))
        directory.mkdir(parents=True, exist_ok=True)
        (directory / audio_path).write_bytes(audio)
        return {
            "input_text": text,
            "input_data": input_data,
            "original_audio": audio_path,
        }
