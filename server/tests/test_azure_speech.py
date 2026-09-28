import pytest

from services import azure_speech


def test_ssml_escapes_user_text_and_voice():
    ssml = azure_speech.build_ssml('A < B & "quoted"', 'voice"><bad')
    assert "A &lt; B &amp; &quot;quoted&quot;" in ssml
    assert 'name="voice&quot;&gt;&lt;bad"' in ssml
    assert "<bad" not in ssml

def test_ssml_uses_requested_language_and_rejects_invalid_locale():
    ssml = azure_speech.build_ssml("مرحبا", "en-US-AvaMultilingualNeural", "ar-EG")
    assert 'xml:lang="ar-EG"' in ssml
    assert "مرحبا" in ssml
    with pytest.raises(ValueError):
        azure_speech.build_ssml("Hello", "voice", 'en-US"><bad')


def test_ssml_rejects_empty_and_oversized_text():
    with pytest.raises(ValueError): azure_speech.build_ssml(" ", "voice")
    with pytest.raises(ValueError): azure_speech.build_ssml("x" * 5001, "voice")


def test_config_requires_server_credentials(monkeypatch):
    monkeypatch.delenv("AZURE_SPEECH_KEY", raising=False)
    monkeypatch.delenv("AZURE_SPEECH_REGION", raising=False)
    with pytest.raises(RuntimeError): azure_speech.speech_config()


@pytest.mark.parametrize("failure,retries", [("timeout", 2), ("503", 2), ("401", 1)])
def test_transient_retry_and_permanent_failure(monkeypatch, failure, retries):
    import asyncio
    import httpx
    from unittest.mock import AsyncMock

    monkeypatch.setattr(azure_speech, "speech_config", lambda: ("test-key", "test-region", "test-voice"))
    request = httpx.Request("POST", "https://example.test")
    error = (httpx.ReadTimeout("", request=request) if failure == "timeout" else
             httpx.HTTPStatusError("failure", request=request, response=httpx.Response(int(failure), request=request)))
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.post.side_effect = [error, httpx.Response(200, content=b"audio", request=request)]
    monkeypatch.setattr(azure_speech.httpx, "AsyncClient", lambda **kwargs: client)
    monkeypatch.setattr(azure_speech.asyncio, "sleep", AsyncMock())
    if retries == 1:
        with pytest.raises(httpx.HTTPStatusError):
            asyncio.run(azure_speech.synthesize("Example text"))
    else:
        assert asyncio.run(azure_speech.synthesize("Example text")) == b"audio"
    assert client.post.call_count == retries


def test_manim_adapter_uses_shared_azure_and_voice_cache(monkeypatch, tmp_path):
    from services import manim_azure_speech as adapter
    from unittest.mock import AsyncMock
    monkeypatch.setattr(adapter, "speech_config", lambda: ("secret", "region", "configured-voice"))
    synthesis = AsyncMock(return_value=b"azure-mp3")
    monkeypatch.setattr(adapter, "synthesize", synthesis)
    service = adapter.MindEaseAzureSpeechService(cache_dir=tmp_path, transcription_model=None)
    result = service.generate_from_text("Hello learner.")
    assert (tmp_path / result["original_audio"]).read_bytes() == b"azure-mp3"
    assert result["input_data"]["voice"] == "configured-voice"
    assert "secret" not in str(result)
    synthesis.assert_awaited_once_with("Hello learner.")
