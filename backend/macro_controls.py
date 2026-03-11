from typing import Dict, Any
import numpy as np


class MacroControls:
    """
    Macro controls for real-time trajectory manipulation.
    Inspired by SpatAI's TSpeed, Scale, and Shift parameters.
    """
    
    def __init__(self):
        self.t_speed = 1.0
        self.scale_x = 1.0
        self.scale_y = 1.0
        self.scale_z = 1.0
        self.shift_x = 0.0
        self.shift_y = 0.0
        self.shift_z = 0.0
    
    def set_time_speed(self, speed: float):
        """
        Time dilation control.
        speed > 1.0: faster playback
        speed < 1.0: slower playback
        """
        self.t_speed = max(0.1, min(speed, 10.0))
    
    def set_scale(self, x: float = 1.0, y: float = 1.0, z: float = 1.0):
        """
        Spatial density control.
        scale > 1.0: expand
        scale < 1.0: contract
        """
        self.scale_x = max(0.1, min(x, 5.0))
        self.scale_y = max(0.1, min(y, 5.0))
        self.scale_z = max(0.1, min(z, 5.0))
    
    def set_shift(self, x: float = 0.0, y: float = 0.0, z: float = 0.0):
        """
        Spatial offset control.
        Translates entire scene in 3D space.
        """
        self.shift_x = max(-2.0, min(x, 2.0))
        self.shift_y = max(-2.0, min(y, 2.0))
        self.shift_z = max(-2.0, min(z, 2.0))
    
    def apply_to_position(self, position: Dict[str, float]) -> Dict[str, float]:
        """
        Apply macro controls to a single position.
        Order: Scale → Shift
        """
        return {
            'x': position['x'] * self.scale_x + self.shift_x,
            'y': position['y'] * self.scale_y + self.shift_y,
            'z': position['z'] * self.scale_z + self.shift_z
        }
    
    def apply_to_time(self, t: float) -> float:
        """Apply time speed to time value"""
        return t * self.t_speed
    
    def get_state(self) -> Dict[str, Any]:
        """Get current macro control state"""
        return {
            't_speed': self.t_speed,
            'scale': {
                'x': self.scale_x,
                'y': self.scale_y,
                'z': self.scale_z
            },
            'shift': {
                'x': self.shift_x,
                'y': self.shift_y,
                'z': self.shift_z
            }
        }
    
    def reset(self):
        """Reset all controls to default"""
        self.t_speed = 1.0
        self.scale_x = self.scale_y = self.scale_z = 1.0
        self.shift_x = self.shift_y = self.shift_z = 0.0


class TrajectoryPlayer:
    """
    Trajectory player with macro controls.
    CPU-optimized: Pre-calculates frames with macro controls applied.
    """
    
    def __init__(self, trajectory_engine, fps: int = 60):
        self.trajectory_engine = trajectory_engine
        self.fps = fps
        self.macro_controls = MacroControls()
        self.frames = []
        self.current_frame = 0
        self.is_playing = False
    
    def generate_frames(self):
        """Pre-generate all frames (CPU-friendly)"""
        self.frames = self.trajectory_engine.generate_trajectory(fps=self.fps)
    
    def get_frame(self, frame_index: int) -> Dict[str, Any]:
        """Get frame with macro controls applied"""
        if frame_index >= len(self.frames):
            return None
        
        frame = self.frames[frame_index]
        modified_frame = {
            'time': frame['time'],
            'objects': {}
        }
        
        for obj_id, position in frame['objects'].items():
            if position is not None:
                modified_frame['objects'][obj_id] = self.macro_controls.apply_to_position(position)
            else:
                modified_frame['objects'][obj_id] = None
        
        return modified_frame
    
    def play(self):
        """Start playback"""
        self.is_playing = True
        self.current_frame = 0
    
    def pause(self):
        """Pause playback"""
        self.is_playing = False
    
    def stop(self):
        """Stop and reset"""
        self.is_playing = False
        self.current_frame = 0
    
    def seek(self, time: float):
        """Seek to specific time"""
        frame_index = int(time * self.fps)
        self.current_frame = max(0, min(frame_index, len(self.frames) - 1))
    
    def next_frame(self) -> Dict[str, Any]:
        """Get next frame and advance"""
        if not self.is_playing or self.current_frame >= len(self.frames):
            return None
        
        frame = self.get_frame(self.current_frame)
        self.current_frame += 1
        
        if self.current_frame >= len(self.frames):
            self.is_playing = False
        
        return frame
    
    def get_progress(self) -> float:
        """Get playback progress (0.0 to 1.0)"""
        if len(self.frames) == 0:
            return 0.0
        return self.current_frame / len(self.frames)


def test_macro_controls():
    """Test macro controls"""
    print("🧪 Testing Macro Controls\n")
    
    controls = MacroControls()
    
    original_pos = {'x': 0.5, 'y': 0.3, 'z': 0.0}
    print(f"Original position: {original_pos}")
    
    print("\n1. Scale x2:")
    controls.set_scale(2.0, 2.0, 2.0)
    scaled = controls.apply_to_position(original_pos)
    print(f"   Scaled: {scaled}")
    
    print("\n2. Shift +0.2 on all axes:")
    controls.set_shift(0.2, 0.2, 0.2)
    shifted = controls.apply_to_position(original_pos)
    print(f"   Shifted: {shifted}")
    
    print("\n3. Time speed x2:")
    controls.set_time_speed(2.0)
    t_original = 5.0
    t_modified = controls.apply_to_time(t_original)
    print(f"   Time: {t_original}s → {t_modified}s")
    
    print("\n4. Reset:")
    controls.reset()
    reset_pos = controls.apply_to_position(original_pos)
    print(f"   Reset position: {reset_pos}")
    
    print("\n✅ Macro controls test completed")


if __name__ == "__main__":
    test_macro_controls()
