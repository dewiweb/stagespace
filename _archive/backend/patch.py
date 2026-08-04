"""
Patch Manager — Gestion des objets audio et des groupes

Permet de définir des objets audio (correspondance avec les tracks du récepteur OSC)
et de créer des groupes d'objets avec un moteur de trajectoire assigné.
"""

import json
from typing import Dict, List, Any, Optional
from pathlib import Path

PATCH_FILE = Path(__file__).parent / "patch.json"


class PatchManager:
    def __init__(self):
        self.objects: Dict[int, Dict[str, Any]] = {}
        self.groups: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self):
        """Charge le patch depuis le fichier JSON."""
        if PATCH_FILE.exists():
            try:
                with open(PATCH_FILE, 'r') as f:
                    data = json.load(f)
                    self.objects = {int(k): v for k, v in data.get('objects', {}).items()}
                    self.groups = data.get('groups', {})
            except Exception as e:
                print(f"Failed to load patch: {e}")
                self.objects = {}
                self.groups = {}

    def _save(self):
        """Sauvegarde le patch dans le fichier JSON."""
        try:
            with open(PATCH_FILE, 'w') as f:
                json.dump({
                    'objects': self.objects,
                    'groups': self.groups,
                }, f, indent=2)
        except Exception as e:
            print(f"Failed to save patch: {e}")

    def list_objects(self) -> List[Dict[str, Any]]:
        """Retourne la liste de tous les objets."""
        return [
            {
                'osc_id': osc_id,
                **obj
            }
            for osc_id, obj in self.objects.items()
        ]

    def set_object(self, osc_id: int, name: str, color: str, notes: str = '') -> Dict[str, Any]:
        """Crée ou met à jour un objet."""
        self.objects[osc_id] = {
            'name': name,
            'color': color,
            'notes': notes,
        }
        self._save()
        return self.objects[osc_id]

    def remove_object(self, osc_id: int) -> None:
        """Supprime un objet."""
        if osc_id in self.objects:
            del self.objects[osc_id]
            self._save()

    def list_groups(self) -> Dict[str, Dict[str, Any]]:
        """Retourne tous les groupes."""
        return self.groups

    def set_group(
        self,
        name: str,
        object_ids: List[int],
        engine: str,
        params: Dict[str, Any],
        profile: str,
        color: str,
        anchor: Dict[str, float],
    ) -> Dict[str, Any]:
        """Crée ou met à jour un groupe."""
        self.groups[name] = {
            'object_ids': object_ids,
            'engine': engine,
            'params': params,
            'profile': profile,
            'color': color,
            'anchor': anchor,
        }
        self._save()
        return self.groups[name]

    def remove_group(self, name: str) -> None:
        """Supprime un groupe."""
        if name in self.groups:
            del self.groups[name]
            self._save()

    def group_to_play_params(self, name: str, host: str, port: int, fps: int) -> Dict[str, Any]:
        """Convertit un groupe en paramètres de playback."""
        group = self.groups.get(name)
        if not group:
            raise KeyError(f"Group '{name}' not found")

        # Filter out params that are not engine-specific
        engine_params = {k: v for k, v in group['params'].items() if k not in ['n_objects', 'object_offset']}

        return {
            'engine': group['engine'],
            'profile': group['profile'],
            'host': host,
            'port': port,
            'fps': fps,
            'params': engine_params,
            'object_offset': 0,
            'label': name,
            'shift': group.get('anchor', {'x': 0.0, 'y': 0.0, 'z': 0.0}),
        }

    def clear(self) -> None:
        """Efface tout le patch."""
        self.objects = {}
        self.groups = {}
        self._save()
