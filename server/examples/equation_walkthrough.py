"""
Example: Equation Walkthrough Animation
Shows how to animate mathematical equations step-by-step with highlighting.

IMPORTANT: When using MathTex, each part MUST be valid LaTeX on its own!
Use set_color_by_tex() for complex formulas instead of splitting.
"""
from manim import *


class SoftmaxEquation(Scene):
    def construct(self):
        # Title
        title = Text("Understanding the Softmax Function", font_size=36)
        self.play(Write(title))
        self.wait(0.5)
        self.play(title.animate.to_edge(UP))
        
        # Main equation - write as SINGLE string, use set_color_by_tex for highlighting
        # DO NOT split \frac{}{} across multiple parts - it will crash!
        equation = MathTex(
            r"\text{softmax}(x_i) = \frac{e^{x_i}}{\sum_{j} e^{x_j}}",
            font_size=40
        )
        self.play(Write(equation))
        self.wait()
        
        # Method 1: Highlight using set_color_by_tex (SAFE)
        # This colors all matching substrings
        equation_copy = equation.copy()
        
        # Highlight the exponential part
        self.play(equation.animate.set_color_by_tex("e^{x_i}", YELLOW))
        
        numerator_label = Text("Exponential of input", font_size=24, color=YELLOW)
        numerator_label.next_to(equation, UP, buff=0.5)
        self.play(FadeIn(numerator_label))
        self.wait()
        self.play(FadeOut(numerator_label))
        
        # Reset and highlight denominator
        self.play(Transform(equation, equation_copy))
        self.play(equation.animate.set_color_by_tex("sum", BLUE))
        
        denom_label = Text("Sum normalizes to 1", font_size=24, color=BLUE)
        denom_label.next_to(equation, DOWN, buff=0.5)
        self.play(FadeIn(denom_label))
        self.wait()
        self.play(FadeOut(denom_label))
        
        # Show result property
        self.play(Transform(equation, equation_copy))
        
        result = MathTex(r"\sum_i \text{softmax}(x_i) = 1", color=GREEN)
        result.next_to(equation, DOWN, buff=1)
        self.play(Write(result))
        self.play(Circumscribe(result, color=GREEN))
        self.wait(2)


class AttentionEquation(Scene):
    """
    Example showing the CORRECT way to handle complex formulas like attention.
    Uses set_color_by_tex instead of dangerous splitting.
    """
    def construct(self):
        title = Text("Scaled Dot-Product Attention", font_size=36)
        self.play(Write(title))
        self.play(title.animate.to_edge(UP))
        
        # CORRECT: Write complex formula as SINGLE string
        attention = MathTex(
            r"\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V",
            font_size=32
        )
        self.play(Write(attention))
        self.wait()
        
        # Create labeled copies for each part we want to highlight
        # Highlight Q - blue
        self.play(attention.animate.set_color_by_tex("Q", BLUE))
        q_label = Text("Query", font_size=20, color=BLUE)
        q_label.next_to(attention, DOWN, buff=0.3)
        self.play(FadeIn(q_label))
        self.wait(0.5)
        
        # Highlight K - orange  
        self.play(attention.animate.set_color_by_tex("K", ORANGE))
        k_label = Text("Key", font_size=20, color=ORANGE)
        k_label.next_to(q_label, RIGHT, buff=0.5)
        self.play(FadeIn(k_label))
        self.wait(0.5)
        
        # Highlight V - green
        self.play(attention.animate.set_color_by_tex("V", GREEN))
        v_label = Text("Value", font_size=20, color=GREEN)
        v_label.next_to(k_label, RIGHT, buff=0.5)
        self.play(FadeIn(v_label))
        self.wait()
        
        # Clean up labels
        self.play(FadeOut(q_label), FadeOut(k_label), FadeOut(v_label))
        
        # Show the scaling factor
        scaling = MathTex(r"\sqrt{d_k}", font_size=40, color=YELLOW)
        scaling.next_to(attention, DOWN, buff=0.8)
        scaling_label = Text("Scaling factor prevents large dot products", font_size=20)
        scaling_label.next_to(scaling, DOWN, buff=0.2)
        
        self.play(FadeIn(scaling), FadeIn(scaling_label))
        self.play(Circumscribe(scaling, color=YELLOW))
        self.wait(2)


class SimpleEquationParts(Scene):
    """
    Example showing when it IS safe to split MathTex.
    Each part must be complete, valid LaTeX on its own.
    """
    def construct(self):
        title = Text("Safe MathTex Splitting", font_size=36)
        self.play(Write(title))
        self.play(title.animate.to_edge(UP))
        
        # SAFE: Each part is complete valid LaTeX
        equation = MathTex(
            "a",      # Part 0 - valid
            "+",      # Part 1 - valid
            "b",      # Part 2 - valid
            "=",      # Part 3 - valid
            "c",      # Part 4 - valid
            font_size=48
        )
        self.play(Write(equation))
        self.wait()
        
        # Now we can safely color individual parts by index
        self.play(equation[0].animate.set_color(RED))
        self.play(equation[2].animate.set_color(BLUE))
        self.play(equation[4].animate.set_color(GREEN))
        self.wait()
        
        # Another safe example - complete fractions
        self.play(FadeOut(equation))
        
        equation2 = MathTex(
            r"\frac{1}{2}",  # Complete fraction - valid
            "+",              # Valid
            r"\frac{3}{4}",  # Complete fraction - valid
            font_size=48
        )
        self.play(Write(equation2))
        self.wait()
        
        self.play(equation2[0].animate.set_color(YELLOW))
        self.play(equation2[2].animate.set_color(TEAL))
        self.wait(2)
