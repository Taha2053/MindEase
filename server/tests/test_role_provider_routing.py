"""Role boundaries for the MindEase video pipeline."""

import asyncio

import agents.base as base
from agents.manim_generator import ManimGenerator
from agents.section_analyzer import SectionAnalyzer
from agents.visualization_planner import VisualizationPlanner


def test_planning_chain_prefers_deepseek_then_mistral(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test")
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-reasoner")
    monkeypatch.setenv("MISTRAL_API_KEY", "mistral-test")
    assert base._configured_role_chain(("deepseek", "mistral")) == ["deepseek", "mistral"]


def test_planning_falls_back_to_mistral(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test")
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-reasoner")
    monkeypatch.setenv("MISTRAL_API_KEY", "mistral-test")
    calls = []

    async def fake_execute(provider, resolved_model, prompt, system_prompt, max_tokens, name, json_mode):
        calls.append((provider, resolved_model))
        if provider == "deepseek":
            raise RuntimeError("planner unavailable")
        return '{"plan": "grounded"}'

    monkeypatch.setattr(base, "_execute_provider_call", fake_execute)
    result = asyncio.run(base.call_llm(
        "Plan this lesson",
        providers=("deepseek", "mistral"),
        json_mode=True,
    ))

    assert result == '{"plan": "grounded"}'
    assert calls == [
        ("deepseek", "deepseek-reasoner"),
        ("mistral", "codestral-latest"),
    ]


def test_generation_chain_is_mistral_only(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test")
    monkeypatch.setenv("MISTRAL_API_KEY", "mistral-test")
    assert base._configured_role_chain(("mistral",)) == ["mistral"]


def test_pipeline_agents_declare_their_provider_roles(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test")
    monkeypatch.setenv("MISTRAL_API_KEY", "mistral-test")
    assert SectionAnalyzer().providers == ("deepseek", "mistral")
    assert VisualizationPlanner().providers == ("deepseek", "mistral")
    assert ManimGenerator().providers == ("mistral",)
