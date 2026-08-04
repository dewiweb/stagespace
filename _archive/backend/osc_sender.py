from pythonosc import udp_client
from pythonosc.osc_message_builder import OscMessageBuilder
from typing import Dict, Any, List
import time
import asyncio


class OSCProfile:
    """Base class for OSC renderer profiles"""
    
    def __init__(self, host: str = "127.0.0.1", port: int = 8000):
        self.host = host
        self.port = port
        self.client = udp_client.SimpleUDPClient(host, port)
    
    def send_position(self, object_id: int, position: Dict[str, float]):
        """Send position data to renderer (to be overridden)"""
        raise NotImplementedError


class IEMMultiEncoderProfile(OSCProfile):
    """IEM MultiEncoder (Ambisonics) - Polar coordinates"""
    
    def __init__(self, host: str = "127.0.0.1", port: int = 9000):
        super().__init__(host, port)
    
    def send_position(self, object_id: int, position: Dict[str, float]):
        x, y, z = position['x'], position['y'], position['z']
        
        import math
        azimuth = math.degrees(math.atan2(y, x))
        distance = math.sqrt(x**2 + y**2)
        elevation = math.degrees(math.atan2(z, distance)) if distance > 0 else 0
        
        distance_norm = min(math.sqrt(x**2 + y**2 + z**2), 1.0)
        
        address = f"/MultiEncoder/{object_id}/aed"
        self.client.send_message(address, [azimuth, elevation, distance_norm])


class HolophonixProfile(OSCProfile):
    """Holophonix - Cartesian coordinates"""
    
    def __init__(self, host: str = "127.0.0.1", port: int = 8000):
        super().__init__(host, port)
    
    def send_position(self, object_id: int, position: Dict[str, float]):
        address = f"/track/{object_id}/xyz"
        self.client.send_message(address, [position['x'], position['y'], position['z']])


class IRCAMSpatProfile(OSCProfile):
    """IRCAM Spat - Cartesian coordinates"""
    
    def __init__(self, host: str = "127.0.0.1", port: int = 8000):
        super().__init__(host, port)
    
    def send_position(self, object_id: int, position: Dict[str, float]):
        address = f"/source/{object_id}/xyz"
        self.client.send_message(address, [position['x'], position['y'], position['z']])


class GenericCartesianProfile(OSCProfile):
    """Generic Cartesian OSC output"""
    
    def __init__(self, host: str = "127.0.0.1", port: int = 7000):
        super().__init__(host, port)
    
    def send_position(self, object_id: int, position: Dict[str, float]):
        address = f"/object/{object_id}/xyz"
        self.client.send_message(address, [position['x'], position['y'], position['z']])


class GenericPolarProfile(OSCProfile):
    """Generic Polar OSC output"""
    
    def __init__(self, host: str = "127.0.0.1", port: int = 7001):
        super().__init__(host, port)
    
    def send_position(self, object_id: int, position: Dict[str, float]):
        x, y, z = position['x'], position['y'], position['z']
        
        import math
        azimuth = math.degrees(math.atan2(y, x))
        distance = math.sqrt(x**2 + y**2)
        elevation = math.degrees(math.atan2(z, distance)) if distance > 0 else 0
        distance_norm = min(math.sqrt(x**2 + y**2 + z**2), 1.0)
        
        self.client.send_message(f"/object/{object_id}/azim", azimuth)
        self.client.send_message(f"/object/{object_id}/elev", elevation)
        self.client.send_message(f"/object/{object_id}/dist", distance_norm)


OSC_PROFILES = {
    'iem_multiencoder': IEMMultiEncoderProfile,
    'holophonix': HolophonixProfile,
    'ircam_spat': IRCAMSpatProfile,
    'generic_cartesian': GenericCartesianProfile,
    'generic_polar': GenericPolarProfile
}


class OSCSender:
    """Main OSC sender with trajectory playback"""
    
    def __init__(self, profile_name: str = 'generic_cartesian', host: str = "127.0.0.1", port: int = 7000,
                 object_offset: int = 0, label: str = ''):
        if profile_name not in OSC_PROFILES:
            raise ValueError(f"Unknown profile: {profile_name}. Available: {list(OSC_PROFILES.keys())}")
        
        self.profile = OSC_PROFILES[profile_name](host, port)
        self.is_playing = False
        self.object_offset = object_offset
        self.label = label
        self.current_frame = None
        self.speed = 1.0
        self.scale = 1.0
        self.shift = {'x': 0.0, 'y': 0.0, 'z': 0.0}
        self.turbulence = 0.0
        self._sequence = []
        self._fps = 60
    
    @staticmethod
    def frames_to_sequence(frames, object_offset: int = 0):
        """Convert frames array to OSC sequence format.
        
        Args:
            frames: numpy array [obj][frame][x,y,z] or list equivalent
            object_offset: Offset to add to object IDs
        
        Returns:
            List of frame data dicts
        """
        # Convert numpy array to list if needed
        if hasattr(frames, 'tolist'):
            frames = frames.tolist()
        
        # frames is [obj][frame][x,y,z]
        # We need to convert to [frame][obj]{x,y,z}
        n_obj = len(frames)
        if n_obj == 0:
            return []
        
        n_frames = len(frames[0])
        sequence = []
        
        for frame_idx in range(n_frames):
            frame_data = {}
            for obj_idx in range(n_obj):
                x, y, z = frames[obj_idx][frame_idx]
                # Apply object offset (OSC IDs start at 1)
                osc_id = obj_idx + 1 + object_offset
                frame_data[str(osc_id)] = {'x': float(x), 'y': float(y), 'z': float(z)}
            sequence.append(frame_data)
        
        return sequence
    
    def send_frame(self, frame_data: Dict[str, Any]):
        """Send a single frame of trajectory data"""
        modified_frame = {}
        for obj_id, position in frame_data.items():
            if position is not None:
                # Apply macros
                pos = position.copy()
                pos['x'] = (pos['x'] * self.scale + self.shift['x'])
                pos['y'] = (pos['y'] * self.scale + self.shift['y'])
                pos['z'] = (pos['z'] * self.scale + self.shift['z'])
                
                # Apply turbulence (simple random offset)
                if self.turbulence > 0:
                    import random
                    pos['x'] += random.uniform(-self.turbulence, self.turbulence)
                    pos['y'] += random.uniform(-self.turbulence, self.turbulence)
                    pos['z'] += random.uniform(-self.turbulence, self.turbulence)
                
                self.profile.send_position(int(obj_id), pos)
                modified_frame[obj_id] = pos
        
        # Store modified frame for WebSocket
        self.current_frame = modified_frame
    
    async def play_loop(self, sequence: List[Dict[str, Any]] = None, fps: int = 60, loop: bool = True):
        """Play a sequence of frames in a loop."""
        if sequence is not None:
            self._sequence = sequence
            self._fps = fps
        
        self.is_playing = True
        frame_duration = (1.0 / self._fps) / self.speed
        
        while self.is_playing:
            for frame in self._sequence:
                if not self.is_playing:
                    break
                
                self.send_frame(frame)
                await asyncio.sleep(frame_duration)
            
            if not loop:
                break
        
        self.is_playing = False
    
    def stop(self):
        """Stop trajectory playback."""
        self.is_playing = False
    
    def swap_trajectory(self, new_sequence: List[Dict[str, Any]], fps: int = 60, fade_frames: int = 10):
        """Swap the current trajectory with a new one (optional fade)."""
        # For now, just replace the sequence
        # TODO: Implement fade transition
        self._sequence = new_sequence
        self._fps = fps


def test_osc_sender():
    """Test OSC sender with dummy data"""
    import asyncio
    
    print("🧪 Testing OSC Sender\n")
    
    sender = OSCSender('generic_cartesian', port=7000)
    
    print(f"Sending test positions to {sender.profile.host}:{sender.profile.port}")
    
    test_frames = [
        {
            'time': 0.0,
            'objects': {
                1: {'x': 0.0, 'y': 0.0, 'z': 0.0},
                2: {'x': 0.5, 'y': 0.5, 'z': 0.0}
            }
        },
        {
            'time': 0.5,
            'objects': {
                1: {'x': 0.3, 'y': 0.0, 'z': 0.1},
                2: {'x': 0.7, 'y': 0.3, 'z': 0.0}
            }
        }
    ]
    
    for i, frame in enumerate(test_frames):
        print(f"\nFrame {i+1}:")
        sender.send_frame(frame)
        for obj_id, pos in frame['objects'].items():
            print(f"  Object {obj_id}: x={pos['x']:.2f}, y={pos['y']:.2f}, z={pos['z']:.2f}")
        time.sleep(0.5)
    
    print("\n✅ Test completed")


if __name__ == "__main__":
    test_osc_sender()
