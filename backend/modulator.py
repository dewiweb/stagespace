"""
Modulator — LFO modulateur multi-slot
"""

from typing import Dict, Any, List, Optional

WAVEFORMS = ['sine', 'triangle', 'square', 'sawtooth', 'random']


class Modulator:
    def __init__(self):
        self.slots: Dict[str, Dict[str, Any]] = {}

    def add_slot(self, target: str, waveform: str = 'sine', rate: float = 0.5, depth: float = 0.3, center: float = 1.0) -> None:
        """Ajoute un slot de modulation."""
        self.slots[target] = {
            'waveform': waveform,
            'rate': rate,
            'depth': depth,
            'center': center,
        }

    def remove_slot(self, target: str) -> None:
        """Supprime un slot de modulation."""
        if target in self.slots:
            del self.slots[target]

    def get_slots(self) -> Dict[str, Dict[str, Any]]:
        """Retourne tous les slots."""
        return self.slots
