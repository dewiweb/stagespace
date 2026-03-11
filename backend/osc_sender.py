from pythonosc import udp_client
from pythonosc.osc_message_builder import OscMessageBuilder
from typing import Dict, Any, List
import time


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
    
    def __init__(self, profile_name: str = 'generic_cartesian', host: str = "127.0.0.1", port: int = 7000):
        if profile_name not in OSC_PROFILES:
            raise ValueError(f"Unknown profile: {profile_name}. Available: {list(OSC_PROFILES.keys())}")
        
        self.profile = OSC_PROFILES[profile_name](host, port)
        self.is_playing = False
    
    def send_frame(self, frame_data: Dict[str, Any]):
        """Send a single frame of trajectory data"""
        for obj_id, position in frame_data['objects'].items():
            if position is not None:
                self.profile.send_position(int(obj_id), position)
    
    async def play_trajectory(self, trajectory_frames: List[Dict[str, Any]], fps: int = 60, 
                             speed: float = 1.0, on_progress=None):
        """
        Play trajectory with OSC output
        
        Args:
            trajectory_frames: List of frame data from TrajectoryEngine
            fps: Frames per second
            speed: Playback speed multiplier
            on_progress: Callback function(current_frame, total_frames)
        """
        self.is_playing = True
        frame_duration = (1.0 / fps) / speed
        
        for i, frame in enumerate(trajectory_frames):
            if not self.is_playing:
                break
            
            self.send_frame(frame)
            
            if on_progress:
                on_progress(i, len(trajectory_frames))
            
            await asyncio.sleep(frame_duration)
        
        self.is_playing = False
    
    def stop(self):
        """Stop trajectory playback"""
        self.is_playing = False


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
