"""
Example: Data Flow Animation
Shows how to animate data moving through a system with transformations.

SPATIAL BEST PRACTICES DEMONSTRATED:
- Use to_edge() with buff parameter for screen margins
- Use arrange() with buff for element spacing
- Use next_to() with buff for relative positioning
- Stay within safe area: x in [-6, 6], y in [-3.5, 3.5]
- Clear scene sections with FadeOut(*self.mobjects) when needed
"""
from manim import *


class AttentionDataFlow(Scene):
    def construct(self):
        # Title at top with safe buffer from edge
        title = Text("Attention Data Flow", font_size=32)
        title.to_edge(UP, buff=0.5)  # GOOD: buff prevents edge clipping
        self.play(Write(title))
        
        # Helper to create matrix representation
        def create_matrix(label, color):
            rect = Rectangle(
                width=1.5, height=1.0,  # Slightly smaller for better fit
                fill_color=color,
                fill_opacity=0.3,
                stroke_color=color
            )
            text = Text(label, font_size=24, color=color)
            text.move_to(rect)
            return VGroup(rect, text)
        
        # Create input tokens using arrange with buff
        tokens = VGroup(*[
            Square(side_length=0.5, fill_color=BLUE, fill_opacity=0.5)
            for _ in range(4)
        ])
        tokens.arrange(RIGHT, buff=0.15)  # GOOD: explicit buff parameter
        tokens.next_to(title, DOWN, buff=0.5)  # GOOD: relative to title
        
        token_labels = VGroup(*[
            Text(t, font_size=12).move_to(tokens[i])
            for i, t in enumerate(["The", "cat", "sat", "down"])
        ])
        
        self.play(FadeIn(tokens), Write(token_labels))
        self.wait(0.5)
        
        # Create Q, K, V matrices using arrange for consistent spacing
        q_matrix = create_matrix("Q", BLUE)
        k_matrix = create_matrix("K", GREEN)
        v_matrix = create_matrix("V", RED)
        
        # GOOD: Use VGroup.arrange() instead of hardcoded shifts
        qkv_group = VGroup(q_matrix, k_matrix, v_matrix)
        qkv_group.arrange(RIGHT, buff=1.0)  # Consistent spacing
        qkv_group.next_to(tokens, DOWN, buff=0.6)  # Relative to tokens
        
        self.play(
            FadeIn(q_matrix, shift=DOWN * 0.3),
            FadeIn(k_matrix, shift=DOWN * 0.3),
            FadeIn(v_matrix, shift=DOWN * 0.3),
        )
        self.wait(0.5)
        
        # Show Q @ K^T computation - position relative to matrices
        qk_result = MathTex(r"QK^T", font_size=28, color=YELLOW)
        # GOOD: Position between Q and K, below them
        qk_result.next_to(VGroup(q_matrix, k_matrix), DOWN, buff=0.4)
        
        arrow_q = Arrow(q_matrix.get_bottom(), qk_result.get_top(), color=BLUE, buff=0.1)
        arrow_k = Arrow(k_matrix.get_bottom(), qk_result.get_top(), color=GREEN, buff=0.1)
        
        self.play(Create(arrow_q), Create(arrow_k))
        self.play(FadeIn(qk_result))
        self.wait(0.5)
        
        # Transform to softmax result (in place)
        softmax_result = MathTex(
            r"\text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)", 
            font_size=22, 
            color=ORANGE
        )
        softmax_result.move_to(qk_result)  # Same position as qk_result
        self.play(Transform(qk_result, softmax_result))
        self.wait(0.5)
        
        # Connect to V and show final output
        final_arrow = Arrow(qk_result.get_right(), v_matrix.get_left(), color=RED, buff=0.1)
        self.play(Create(final_arrow))
        
        # Output positioned relative to V matrix, not hardcoded
        output = Text("Attention Output", font_size=22, color=WHITE)
        output.next_to(v_matrix, DOWN, buff=0.4)  # GOOD: relative positioning
        output_box = SurroundingRectangle(output, color=YELLOW, buff=0.15)
        
        self.play(FadeIn(output), Create(output_box))
        self.wait(2)
        
        # GOOD: Show how to cleanly transition to next section
        # self.play(FadeOut(*self.mobjects))  # Uncomment to clear scene
