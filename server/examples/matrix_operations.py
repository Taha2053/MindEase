"""
Example: Matrix Operations Animation
Shows how to visualize matrix multiplication and transformations.

SPATIAL BEST PRACTICES DEMONSTRATED:
- Use VGroup.arrange() for consistent element spacing
- Use next_to() with buff for relative positioning
- Keep all elements within safe area: x in [-6, 6], y in [-3.5, 3.5]
- Scale matrices appropriately to fit screen
"""
from manim import *


class MatrixMultiplication(Scene):
    def construct(self):
        # Title with safe edge buffer
        title = Text("Matrix Multiplication", font_size=36)
        title.to_edge(UP, buff=0.4)
        self.play(Write(title))
        
        # Create matrices with smaller scale for better fit
        matrix_a = Matrix(
            [[1, 2], [3, 4]],
            left_bracket="[",
            right_bracket="]"
        ).scale(0.8)
        
        matrix_b = Matrix(
            [[5, 6], [7, 8]],
            left_bracket="[",
            right_bracket="]"
        ).scale(0.8)
        
        times_sign = MathTex(r"\times")
        equals = MathTex("=")
        
        matrix_c = Matrix(
            [["?", "?"], ["?", "?"]],
            left_bracket="[",
            right_bracket="]"
        ).scale(0.8)
        
        # GOOD: Use VGroup.arrange() for consistent spacing
        equation = VGroup(matrix_a, times_sign, matrix_b, equals, matrix_c)
        equation.arrange(RIGHT, buff=0.4)  # Explicit buff for spacing
        equation.next_to(title, DOWN, buff=0.8)  # Relative to title
        
        self.play(
            Write(matrix_a),
            Write(times_sign),
            Write(matrix_b),
            Write(equals),
            Write(matrix_c)
        )
        self.wait()
        
        # Highlight first row of A and first column of B
        row_highlight = SurroundingRectangle(
            matrix_a.get_rows()[0],
            color=YELLOW,
            buff=0.1
        )
        col_highlight = SurroundingRectangle(
            matrix_b.get_columns()[0],
            color=YELLOW,
            buff=0.1
        )
        
        self.play(Create(row_highlight), Create(col_highlight))
        
        # Show the computation - GOOD: position relative to equation
        computation = MathTex(
            r"1 \times 5 + 2 \times 7 = 19",
            font_size=28
        )
        computation.next_to(equation, DOWN, buff=0.8)  # Relative positioning
        
        self.play(Write(computation))
        self.wait()
        
        # Update result matrix (keep in same position)
        new_matrix_c = Matrix(
            [[19, "?"], ["?", "?"]],
            left_bracket="[",
            right_bracket="]"
        ).scale(0.8)
        new_matrix_c.move_to(matrix_c)  # Match position
        
        self.play(
            Transform(matrix_c, new_matrix_c),
            FadeOut(row_highlight),
            FadeOut(col_highlight),
        )
        self.wait()
        
        # Continue with remaining elements (abbreviated)
        final_matrix_c = Matrix(
            [[19, 22], [43, 50]],
            left_bracket="[",
            right_bracket="]"
        ).scale(0.8)
        final_matrix_c.move_to(matrix_c)  # Match position
        
        final_computation = MathTex(
            r"C = A \times B",
            font_size=28,
            color=GREEN
        )
        final_computation.move_to(computation)  # Same position
        
        self.play(
            Transform(matrix_c, final_matrix_c),
            Transform(computation, final_computation),
        )
        self.play(Circumscribe(matrix_c, color=GREEN))
        self.wait(2)
