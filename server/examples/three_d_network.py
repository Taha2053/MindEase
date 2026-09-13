"""
Example: 3D Neural Network Visualization
Shows how to create 3D visualizations using ThreeDScene.
"""
from manim import *


class NeuralNetwork3D(ThreeDScene):
    def construct(self):
        # Set up the 3D camera
        self.set_camera_orientation(phi=75 * DEGREES, theta=-45 * DEGREES)
        
        # Title (2D text overlay)
        title = Text("3D Neural Network", font_size=36)
        title.to_corner(UL)
        self.add_fixed_in_frame_mobjects(title)
        self.play(Write(title))
        
        # Create neurons as spheres
        input_layer = VGroup(*[
            Sphere(radius=0.3, color=BLUE).move_to([0, -1 + i, 0])
            for i in range(3)
        ])
        
        hidden_layer = VGroup(*[
            Sphere(radius=0.3, color=ORANGE).move_to([2, -1.5 + i, 0])
            for i in range(4)
        ])
        
        output_layer = VGroup(*[
            Sphere(radius=0.3, color=GREEN).move_to([4, -0.5 + i, 0])
            for i in range(2)
        ])
        
        # Animate layers appearing
        self.play(Create(input_layer), run_time=1)
        self.play(Create(hidden_layer), run_time=1)
        self.play(Create(output_layer), run_time=1)
        
        # Create connections as lines
        connections = VGroup()
        
        # Input to hidden connections
        for inp in input_layer:
            for hid in hidden_layer:
                line = Line3D(
                    start=inp.get_center(),
                    end=hid.get_center(),
                    color=GRAY,
                    thickness=0.01
                )
                connections.add(line)
        
        # Hidden to output connections
        for hid in hidden_layer:
            for out in output_layer:
                line = Line3D(
                    start=hid.get_center(),
                    end=out.get_center(),
                    color=GRAY,
                    thickness=0.01
                )
                connections.add(line)
        
        self.play(Create(connections), run_time=1.5)
        
        # Rotate the camera for 3D effect
        self.begin_ambient_camera_rotation(rate=0.3)
        self.wait(3)
        self.stop_ambient_camera_rotation()
        
        # Highlight a path through the network
        path_connections = VGroup()
        # Highlight input[1] -> hidden[1] -> output[0]
        highlight_line1 = Line3D(
            start=input_layer[1].get_center(),
            end=hidden_layer[1].get_center(),
            color=YELLOW,
            thickness=0.03
        )
        highlight_line2 = Line3D(
            start=hidden_layer[1].get_center(),
            end=output_layer[0].get_center(),
            color=YELLOW,
            thickness=0.03
        )
        
        self.play(
            Create(highlight_line1),
            input_layer[1].animate.set_color(YELLOW),
            run_time=0.5
        )
        self.play(
            Create(highlight_line2),
            hidden_layer[1].animate.set_color(YELLOW),
            run_time=0.5
        )
        self.play(output_layer[0].animate.set_color(YELLOW), run_time=0.5)
        
        # Add 2D label
        label = Text("Forward propagation path", font_size=24, color=YELLOW)
        label.to_corner(DR)
        self.add_fixed_in_frame_mobjects(label)
        self.play(FadeIn(label))
        
        self.wait(2)


class DataCube3D(ThreeDScene):
    """Example showing 3D data transformation visualization."""
    
    def construct(self):
        self.set_camera_orientation(phi=60 * DEGREES, theta=-60 * DEGREES)
        
        # Create a 3D axes
        axes = ThreeDAxes(
            x_range=[-3, 3],
            y_range=[-3, 3],
            z_range=[-3, 3],
            x_length=6,
            y_length=6,
            z_length=6,
        )
        
        # Create a cube representing data
        cube = Cube(side_length=1.5, fill_color=BLUE, fill_opacity=0.7)
        cube.set_stroke(color=WHITE, width=1)
        
        # Create labels for axes (fixed in frame)
        x_label = Text("Feature 1", font_size=20).to_corner(UR)
        y_label = Text("Feature 2", font_size=20).next_to(x_label, DOWN)
        z_label = Text("Feature 3", font_size=20).next_to(y_label, DOWN)
        
        self.add_fixed_in_frame_mobjects(x_label, y_label, z_label)
        
        self.play(Create(axes), run_time=1)
        self.play(Create(cube), FadeIn(x_label), FadeIn(y_label), FadeIn(z_label))
        
        # Apply a transformation (scaling + rotation)
        self.play(
            cube.animate.scale([2, 0.5, 1]).rotate(PI/4, axis=UP),
            run_time=2
        )
        
        # Show transformation label
        transform_label = Text("Linear Transformation Applied", font_size=24, color=YELLOW)
        transform_label.to_corner(DL)
        self.add_fixed_in_frame_mobjects(transform_label)
        self.play(FadeIn(transform_label))
        
        # Rotate camera to show 3D effect
        self.begin_ambient_camera_rotation(rate=0.2)
        self.wait(4)
        self.stop_ambient_camera_rotation()
