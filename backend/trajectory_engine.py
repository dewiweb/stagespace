import numpy as np
from typing import Dict, List, Tuple, Any
import math


class TrajectoryEngine:
    def __init__(self, trajectory_data: Dict[str, Any]):
        self.duration = trajectory_data['duration']
        self.objects = trajectory_data['objects']
        self.coordinate_system = trajectory_data['coordinate_system']
        self.equations = trajectory_data['equations']
        
        self._compile_equations()
    
    def _compile_equations(self):
        safe_globals = {
            'sin': np.sin,
            'cos': np.cos,
            'tan': np.tan,
            'sqrt': np.sqrt,
            'abs': abs,
            'min': min,
            'max': max,
            'pi': np.pi,
            '__builtins__': {}
        }
        
        self.compiled_equations = {}
        
        for axis, equation_str in self.equations.items():
            try:
                code = compile(equation_str, '<string>', 'eval')
                self.compiled_equations[axis] = (code, safe_globals)
            except SyntaxError as e:
                raise ValueError(f"Invalid equation for {axis}: {equation_str}\nError: {e}")
    
    def calculate_position(self, t: float, object_index: int) -> Dict[str, float]:
        if t < 0 or t > self.duration:
            raise ValueError(f"Time {t} out of range [0, {self.duration}]")
        
        position = {}
        
        for axis, (code, safe_globals) in self.compiled_equations.items():
            local_vars = {
                't': t,
                'objectIndex': object_index,
            }
            
            try:
                value = eval(code, safe_globals, local_vars)
                position[axis] = float(value)
            except Exception as e:
                raise RuntimeError(f"Error evaluating {axis} at t={t}, obj={object_index}: {e}")
        
        self._validate_position(position)
        
        return position
    
    def _validate_position(self, position: Dict[str, float]):
        if self.coordinate_system == 'cartesian':
            for axis in ['x', 'y', 'z']:
                if axis in position:
                    value = position[axis]
                    if not (-2.0 <= value <= 2.0):
                        print(f"⚠️  Warning: {axis}={value} outside typical range [-1, 1]")
        
        elif self.coordinate_system == 'polar':
            if 'azimuth' in position:
                if not (0 <= position['azimuth'] <= 360):
                    print(f"⚠️  Warning: azimuth={position['azimuth']} outside [0, 360]")
            if 'elevation' in position:
                if not (-90 <= position['elevation'] <= 90):
                    print(f"⚠️  Warning: elevation={position['elevation']} outside [-90, 90]")
            if 'distance' in position:
                if not (0 <= position['distance'] <= 2.0):
                    print(f"⚠️  Warning: distance={position['distance']} outside [0, 1]")
    
    def generate_trajectory(self, fps: int = 60) -> List[Dict[str, Any]]:
        frames = []
        num_frames = int(self.duration * fps)
        
        for frame_idx in range(num_frames + 1):
            t = (frame_idx / fps)
            frame_data = {
                'time': round(t, 3),
                'objects': {}
            }
            
            for obj_idx in self.objects:
                try:
                    position = self.calculate_position(t, obj_idx)
                    frame_data['objects'][obj_idx] = position
                except Exception as e:
                    print(f"❌ Error at t={t}, obj={obj_idx}: {e}")
                    frame_data['objects'][obj_idx] = None
            
            frames.append(frame_data)
        
        return frames
    
    def get_trajectory_summary(self) -> Dict[str, Any]:
        try:
            start_positions = {}
            end_positions = {}
            
            for obj_idx in self.objects[:min(3, len(self.objects))]:
                start_positions[obj_idx] = self.calculate_position(0, obj_idx)
                end_positions[obj_idx] = self.calculate_position(self.duration, obj_idx)
            
            return {
                'duration': self.duration,
                'num_objects': len(self.objects),
                'coordinate_system': self.coordinate_system,
                'sample_start': start_positions,
                'sample_end': end_positions
            }
        except Exception as e:
            return {'error': str(e)}


def test_trajectory_engine():
    print("🧪 Testing Trajectory Engine\n")
    
    test_data = {
        'duration': 8.0,
        'objects': [1, 2, 3],
        'coordinate_system': 'cartesian',
        'equations': {
            'x': '0.7 * sin(2*pi*t/8)',
            'y': '0.7 * cos(2*pi*t/8)',
            'z': '0.0'
        }
    }
    
    engine = TrajectoryEngine(test_data)
    
    print("Testing position calculation at different times:")
    for t in [0, 2, 4, 6, 8]:
        pos = engine.calculate_position(t, 1)
        print(f"  t={t}s: x={pos['x']:.3f}, y={pos['y']:.3f}, z={pos['z']:.3f}")
    
    print("\nGenerating full trajectory (60fps)...")
    trajectory = engine.generate_trajectory(fps=60)
    print(f"✅ Generated {len(trajectory)} frames")
    
    print("\nTrajectory summary:")
    summary = engine.get_trajectory_summary()
    for key, value in summary.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    test_trajectory_engine()
