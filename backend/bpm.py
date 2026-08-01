"""
BPM Tracker — Détection de tempo via MIDI clock
"""

from typing import Optional


class BpmTracker:
    def __init__(self):
        self.bpm: Optional[float] = None
        self.clock_count = 0
        self.last_clock_time = 0

    def update_clock(self) -> Optional[float]:
        """Met à jour le BPM à partir du MIDI clock."""
        import time
        now = time.time()
        if self.last_clock_time > 0:
            delta = now - self.last_clock_time
            if delta > 0:
                # 24 clocks per quarter note
                bpm = 60 / (delta * 24)
                self.bpm = bpm
        self.last_clock_time = now
        self.clock_count += 1
        return self.bpm

    def set_bpm(self, bpm: float) -> None:
        """Définit le BPM manuellement."""
        self.bpm = bpm

    def get_bpm(self) -> Optional[float]:
        """Retourne le BPM actuel."""
        return self.bpm
