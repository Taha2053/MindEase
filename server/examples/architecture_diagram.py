"""
Example: Architecture Diagram Animation
Shows how to build neural network/system architecture visualizations.

SPATIAL BEST PRACTICES DEMONSTRATED:
- Use to_edge with buff for safe margins
- Use arrange() with buff for stacking blocks
- Use next_to with buff for annotations
- Scale blocks appropriately for screen fit
"""
from manim import *


class TransformerEncoder(Scene):
    def construct(self):
        title = Text("Transformer Encoder Block", font_size=36)
        title.to_edge(UP, buff=0.3)  # GOOD: explicit buff for safety
        self.play(Write(title))
        
        # Helper function to create labeled blocks
        def create_block(text, color):
            rect = RoundedRectangle(
                width=3, height=0.8,
                corner_radius=0.1,
                fill_color=color,
                fill_opacity=0.3,
                stroke_color=color
            )
            label = Text(text, font_size=20)
            label.move_to(rect)
            return VGroup(rect, label)
        
        # Create architecture components
        input_embed = create_block("Input Embedding", BLUE)
        pos_encoding = create_block("+ Positional Encoding", TEAL)
        attention = create_block("Multi-Head Attention", ORANGE)
        add_norm1 = create_block("Add & Norm", GRAY)
        ffn = create_block("Feed Forward", PURPLE)
        add_norm2 = create_block("Add & Norm", GRAY)
        output = create_block("Output", GREEN)
        
        # Stack vertically
        blocks = VGroup(
            input_embed, pos_encoding, attention,
            add_norm1, ffn, add_norm2, output
        )
        blocks.arrange(DOWN, buff=0.3)
        blocks.move_to(ORIGIN)
        
        # Animate building the architecture
        for block in blocks:
            self.play(FadeIn(block, shift=UP * 0.3), run_time=0.4)
        
        # Add connecting arrows
        arrows = VGroup()
        for i in range(len(blocks) - 1):
            arrow = Arrow(
                blocks[i].get_bottom(),
                blocks[i + 1].get_top(),
                buff=0.1,
                color=WHITE,
                stroke_width=2
            )
            arrows.add(arrow)
        
        self.play(Create(arrows), run_time=1)
        
        # Highlight attention mechanism
        self.play(
            attention[0].animate.set_fill(ORANGE, opacity=0.6),
            run_time=0.5
        )
        
        attention_note = Text(
            "Self-attention enables\nparallel processing",
            font_size=18,
            color=ORANGE
        )
        attention_note.next_to(attention, RIGHT, buff=0.5)
        self.play(FadeIn(attention_note))
        self.wait(2)
