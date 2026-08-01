"""
Preset Manager — Sauvegarde et restauration de configurations
"""

import json
from typing import Dict, Any, Optional, List
from pathlib import Path

PRESETS_FILE = Path(__file__).parent / "presets.json"


class PresetManager:
    def __init__(self):
        self.presets: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self):
        """Charge les presets depuis le fichier JSON."""
        if PRESETS_FILE.exists():
            try:
                with open(PRESETS_FILE, 'r') as f:
                    self.presets = json.load(f)
            except Exception as e:
                print(f"Failed to load presets: {e}")
                self.presets = {}

    def _save(self):
        """Sauvegarde les presets dans le fichier JSON."""
        try:
            with open(PRESETS_FILE, 'w') as f:
                json.dump(self.presets, f, indent=2)
        except Exception as e:
            print(f"Failed to save presets: {e}")

    def save(self, name: str, config: Dict[str, Any]) -> None:
        """Sauvegarde un preset."""
        self.presets[name] = config
        self._save()

    def load(self, name: str) -> Optional[Dict[str, Any]]:
        """Charge un preset."""
        return self.presets.get(name)

    def delete(self, name: str) -> None:
        """Supprime un preset."""
        if name in self.presets:
            del self.presets[name]
            self._save()

    def get_presets(self) -> List[str]:
        """Retourne la liste des presets."""
        return list(self.presets.keys())
