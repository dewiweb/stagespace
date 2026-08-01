"""
OSC Receiver — Réception OSC avec mapping configurable
"""

from typing import Dict, Any, Callable, Optional
import asyncio


class OscReceiver:
    def __init__(self, port: int, sessions: Dict[str, Any], bpm_tracker: Any, audio_reactor: Any):
        self.port = port
        self.sessions = sessions
        self.bpm_tracker = bpm_tracker
        self.audio_reactor = audio_reactor
        self.mappings: Dict[str, Any] = {}
        self.server: Optional[asyncio.Server] = None

    def add_mapping(self, address: str, handler: str, transform: Optional[str] = None) -> None:
        """Ajoute un mapping OSC → handler."""
        self.mappings[address] = {
            'handler': handler,
            'transform': transform,
        }

    async def start(self) -> None:
        """Démarre le serveur OSC."""
        # Placeholder: implementation would use python-osc
        print(f"OSC Receiver would start on port {self.port}")

    async def stop(self) -> None:
        """Arrête le serveur OSC."""
        if self.server:
            self.server.close()
