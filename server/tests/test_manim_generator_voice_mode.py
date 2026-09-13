from agents.manim_generator import ManimGenerator
from models.generation import VisualizationType


def test_extract_scene_class_name_supports_voiceover_scene():
    generator = ManimGenerator.__new__(ManimGenerator)
    code = """
from manim import *
from manim_voiceover import VoiceoverScene

class VoiceAligned(VoiceoverScene):
    def construct(self):
        pass
"""
    assert generator._extract_scene_class_name(code) == "VoiceAligned"


def test_extract_narration_lines_and_beats():
    generator = ManimGenerator.__new__(ManimGenerator)
    code = """
# Beat 1: intro
# Beat 2: scoring
with self.voiceover(text=\"Queries compare keys to score relevance across tokens in context-rich attention maps.\") as tracker:
    self.play(Create(arrow), run_time=tracker.duration)
# Beat 3: weighting
with self.voiceover(text=\"Softmax normalizes similarities so weighted values form each contextual representation cleanly.\") as tracker:
    self.play(Write(eq), run_time=tracker.duration)
"""
    lines = generator._extract_narration_lines(code)
    beats = generator._extract_beat_labels(code)

    assert len(lines) == 2
    assert lines[0].startswith("Queries compare keys")
    assert beats == ["# Beat 1: intro", "# Beat 2: scoring", "# Beat 3: weighting"]


def test_selects_voiceover_examples_when_enabled():
    generator = ManimGenerator.__new__(ManimGenerator)
    generator.examples = {VisualizationType.DATA_FLOW: "plain_example"}
    generator.voiceover_examples = {VisualizationType.DATA_FLOW: "voiceover_example"}

    selected_voice = generator._get_example_for_type(VisualizationType.DATA_FLOW, voiceover_enabled=True)
    selected_plain = generator._get_example_for_type(VisualizationType.DATA_FLOW, voiceover_enabled=False)

    assert selected_voice == "voiceover_example"
    assert selected_plain == "plain_example"
