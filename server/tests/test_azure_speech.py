import pytest

from services import azure_speech


def test_ssml_escapes_user_text_and_voice():
    ssml = azure_speech.build_ssml('A < B & "quoted"', 'voice"><bad')
    assert "A &lt; B &amp; &quot;quoted&quot;" in ssml
    assert 'name="voice&quot;&gt;&lt;bad"' in ssml
    assert "<bad" not in ssml


def test_ssml_rejects_empty_and_oversized_text():
    with pytest.raises(ValueError): azure_speech.build_ssml(" ", "voice")
    with pytest.raises(ValueError): azure_speech.build_ssml("x" * 5001, "voice")


def test_config_requires_server_credentials(monkeypatch):
    monkeypatch.delenv("AZURE_SPEECH_KEY", raising=False)
    monkeypatch.delenv("AZURE_SPEECH_REGION", raising=False)
    with pytest.raises(RuntimeError): azure_speech.speech_config()
