"""
Audio Reactor — Réaction audio (RMS, bass, mid, high)
"""

from typing import Dict, Any, Optional

AUDIO_SOURCES = ['microphone', 'file', 'stream']


class AudioReactor:
    def __init__(self, sessions: Dict[str, Any]):
        self.sessions = sessions
        self.audio_frame: Optional[Dict[str, float]] = None

    def update(self, audio_frame: Dict[str, float]) -> None:
        """Met à jour les données audio."""
        self.audio_frame = audio_frame

    def get_frame(self) -> Optional[Dict[str, float]]:
        """Retourne les données audio actuelles."""
        return self.audio_frame
