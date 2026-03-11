from typing import Dict, Any, List, Tuple
from trajectory_engine import TrajectoryEngine


class TrajectoryValidator:
    @staticmethod
    def validate_trajectory(trajectory_data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        errors = []
        warnings = []
        
        if 'duration' not in trajectory_data:
            errors.append("Missing 'duration' field")
        elif trajectory_data['duration'] <= 0:
            errors.append(f"Invalid duration: {trajectory_data['duration']}")
        
        if 'objects' not in trajectory_data:
            errors.append("Missing 'objects' field")
        elif not isinstance(trajectory_data['objects'], list) or len(trajectory_data['objects']) == 0:
            errors.append("'objects' must be a non-empty list")
        
        if 'coordinate_system' not in trajectory_data:
            errors.append("Missing 'coordinate_system' field")
        elif trajectory_data['coordinate_system'] not in ['cartesian', 'polar']:
            errors.append(f"Invalid coordinate_system: {trajectory_data['coordinate_system']}")
        
        if 'equations' not in trajectory_data:
            errors.append("Missing 'equations' field")
        else:
            coord_sys = trajectory_data.get('coordinate_system')
            equations = trajectory_data['equations']
            
            if coord_sys == 'cartesian':
                required = ['x', 'y', 'z']
            elif coord_sys == 'polar':
                required = ['azimuth', 'elevation', 'distance']
            else:
                required = []
            
            for axis in required:
                if axis not in equations:
                    errors.append(f"Missing equation for '{axis}'")
                elif not isinstance(equations[axis], str):
                    errors.append(f"Equation for '{axis}' must be a string")
        
        if errors:
            return False, errors
        
        try:
            engine = TrajectoryEngine(trajectory_data)
            
            test_times = [0, trajectory_data['duration'] / 2, trajectory_data['duration']]
            test_objects = trajectory_data['objects'][:min(3, len(trajectory_data['objects']))]
            
            for t in test_times:
                for obj in test_objects:
                    try:
                        pos = engine.calculate_position(t, obj)
                        
                        for axis, value in pos.items():
                            if not isinstance(value, (int, float)):
                                errors.append(f"Invalid value type for {axis}: {type(value)}")
                            elif abs(value) > 1000:
                                warnings.append(f"Extreme value at t={t}, obj={obj}, {axis}={value}")
                    
                    except Exception as e:
                        errors.append(f"Calculation error at t={t}, obj={obj}: {str(e)}")
            
            if errors:
                return False, errors
            
            return True, warnings
        
        except Exception as e:
            errors.append(f"Engine initialization error: {str(e)}")
            return False, errors
    
    @staticmethod
    def score_trajectory(trajectory_data: Dict[str, Any], expected_behavior: str = None) -> Dict[str, Any]:
        is_valid, messages = TrajectoryValidator.validate_trajectory(trajectory_data)
        
        score = {
            'valid': is_valid,
            'errors': [m for m in messages if 'error' in m.lower() or not is_valid],
            'warnings': [m for m in messages if 'warning' in m.lower() and is_valid],
            'quality_score': 0.0
        }
        
        if not is_valid:
            return score
        
        quality = 100.0
        
        if len(score['warnings']) > 0:
            quality -= len(score['warnings']) * 10
        
        try:
            engine = TrajectoryEngine(trajectory_data)
            
            test_points = 10
            smoothness_errors = 0
            
            for obj in trajectory_data['objects'][:3]:
                prev_pos = None
                for i in range(test_points):
                    t = (i / (test_points - 1)) * trajectory_data['duration']
                    pos = engine.calculate_position(t, obj)
                    
                    if prev_pos:
                        for axis in pos.keys():
                            delta = abs(pos[axis] - prev_pos[axis])
                            if delta > 0.5:
                                smoothness_errors += 1
                    
                    prev_pos = pos
            
            if smoothness_errors > 0:
                quality -= min(smoothness_errors * 5, 30)
        
        except Exception as e:
            quality -= 20
            score['warnings'].append(f"Quality check error: {str(e)}")
        
        score['quality_score'] = max(0, quality)
        
        return score


def test_validator():
    print("🧪 Testing Trajectory Validator\n")
    
    valid_trajectory = {
        'duration': 8.0,
        'objects': [1, 2, 3],
        'coordinate_system': 'cartesian',
        'equations': {
            'x': '0.7 * sin(2*pi*t/8)',
            'y': '0.7 * cos(2*pi*t/8)',
            'z': '0.0'
        }
    }
    
    print("Test 1: Valid trajectory")
    is_valid, messages = TrajectoryValidator.validate_trajectory(valid_trajectory)
    print(f"  Valid: {is_valid}")
    if messages:
        print(f"  Messages: {messages}")
    
    score = TrajectoryValidator.score_trajectory(valid_trajectory)
    print(f"  Quality score: {score['quality_score']}/100")
    
    print("\nTest 2: Invalid trajectory (missing field)")
    invalid_trajectory = {
        'duration': 8.0,
        'coordinate_system': 'cartesian',
        'equations': {'x': '0', 'y': '0', 'z': '0'}
    }
    is_valid, messages = TrajectoryValidator.validate_trajectory(invalid_trajectory)
    print(f"  Valid: {is_valid}")
    print(f"  Errors: {messages}")
    
    print("\nTest 3: Invalid equation")
    bad_equation = {
        'duration': 8.0,
        'objects': [1],
        'coordinate_system': 'cartesian',
        'equations': {
            'x': 'invalid_function(t)',
            'y': '0',
            'z': '0'
        }
    }
    is_valid, messages = TrajectoryValidator.validate_trajectory(bad_equation)
    print(f"  Valid: {is_valid}")
    print(f"  Errors: {messages}")


if __name__ == "__main__":
    test_validator()
