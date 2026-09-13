"""
Example: Algorithm Step-by-Step Animation
Shows how to animate an algorithm's execution with visual state changes.

SPATIAL BEST PRACTICES DEMONSTRATED:
- Use to_edge/to_corner with buff for safe margins
- Use next_to with buff for label positioning
- Keep axes centered with move_to(ORIGIN) or shift for adjustment
- Use relative positioning for dynamic elements
"""
from manim import *


class GradientDescent(Scene):
    def construct(self):
        # Title with safe edge buffer
        title = Text("Gradient Descent", font_size=36)
        title.to_edge(UP, buff=0.4)  # GOOD: explicit buff
        self.play(Write(title))
        
        # Create axes for loss function - centered with room for labels
        axes = Axes(
            x_range=[-3, 3, 1],
            y_range=[0, 10, 2],
            x_length=6,
            y_length=3.5,  # Slightly smaller for better fit
            tips=False
        )
        # GOOD: Position relative to title, not hardcoded
        axes.next_to(title, DOWN, buff=0.6)
        
        # Draw loss curve (simple parabola)
        loss_curve = axes.plot(lambda x: x**2, color=BLUE)
        loss_label = Text("Loss", font_size=20, color=BLUE)
        loss_label.next_to(loss_curve, UR, buff=0.1)  # GOOD: with buff
        
        self.play(Create(axes), Create(loss_curve), Write(loss_label))
        
        # Value tracker for animated position
        x_val = ValueTracker(2.5)
        
        # Dot that follows the curve
        dot = always_redraw(lambda: Dot(
            axes.c2p(x_val.get_value(), x_val.get_value()**2),
            color=RED
        ))
        
        self.play(FadeIn(dot))
        self.wait(0.5)
        
        # Step counter - GOOD: use to_corner with buff
        steps_text = Text("Step 1", font_size=24)
        steps_text.to_corner(UL, buff=0.5)  # Safe corner position
        self.play(Write(steps_text))
        
        # Perform gradient descent steps
        learning_rate = 0.3
        
        for i in range(5):
            current_x = x_val.get_value()
            gradient = 2 * current_x  # Derivative of x^2
            new_x = current_x - learning_rate * gradient
            
            # Show gradient arrow (pointing in direction of descent)
            arrow = Arrow(
                axes.c2p(current_x, current_x**2),
                axes.c2p(current_x - 0.5 * gradient, current_x**2),
                color=YELLOW,
                buff=0
            )
            
            self.play(Create(arrow), run_time=0.3)
            self.play(
                x_val.animate.set_value(new_x),
                FadeOut(arrow),
                run_time=0.5
            )
            
            # Update step counter
            new_step = Text(f"Step {i + 2}", font_size=24)
            new_step.to_corner(UL).shift(DOWN)
            self.play(Transform(steps_text, new_step), run_time=0.2)
        
        # Show convergence
        converged = Text("Converged!", font_size=28, color=GREEN)
        converged.next_to(dot, RIGHT, buff=0.5)
        self.play(FadeIn(converged))
        self.play(Circumscribe(dot, color=GREEN))
        self.wait(2)
