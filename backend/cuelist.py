"""
Cue List Manager — Gestion des cues (snapshots de playback)
"""

import json
from typing import Dict, List, Any, Optional
from pathlib import Path

CUELIST_FILE = Path(__file__).parent / "cuelist.json"


class CuelistManager:
    def __init__(self):
        self.cues: List[Dict[str, Any]] = []
        self._load()

    def _load(self):
        """Charge la cue list depuis le fichier JSON."""
        if CUELIST_FILE.exists():
            try:
                with open(CUELIST_FILE, 'r') as f:
                    self.cues = json.load(f)
            except Exception as e:
                print(f"Failed to load cuelist: {e}")
                self.cues = []

    def _save(self):
        """Sauvegarde la cue list dans le fichier JSON."""
        try:
            with open(CUELIST_FILE, 'w') as f:
                json.dump(self.cues, f, indent=2)
        except Exception as e:
            print(f"Failed to save cuelist: {e}")

    def add(self, cue: Dict[str, Any]) -> None:
        """Ajoute un cue."""
        self.cues.append(cue)
        self._save()

    def remove(self, index: int) -> None:
        """Supprime un cue."""
        if 0 <= index < len(self.cues):
            self.cues.pop(index)
            self._save()

    def clear(self) -> None:
        """Efface la cue list."""
        self.cues = []
        self._save()
