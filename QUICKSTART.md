# OSCAI POC - Guide de Démarrage Rapide

## Installation (5 minutes)

### 1. Installer Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Télécharger le modèle LLM

```bash
ollama pull qwen2.5-coder:7b
```

### 3. Installer les dépendances Python

```bash
pip install -r requirements.txt
```

## Utilisation

### Option A : Script Automatique (Recommandé)

```bash
chmod +x run_poc.sh
./run_poc.sh
```

Menu interactif avec toutes les options.

### Option B : Commandes Manuelles

#### Test Rapide (3 prompts)
```bash
python3 backend/llm_engine.py
```

#### Suite de Tests Complète (20 prompts)
```bash
python3 tests/test_prompts.py
```

#### Benchmark Performance
```bash
python3 tests/benchmark.py
```

#### Comparer Plusieurs Modèles
```bash
python3 tests/benchmark.py --compare qwen2.5-coder:7b deepseek-r1:7b llama3.1:8b
```

#### Visualisation 3D
```bash
python3 -m http.server 8000
# Ouvrir http://localhost:8000/visualization/visualizer.html
```

## Interprétation des Résultats

### Critères de Validation GO/NO-GO

✅ **GO** si :
- Taux de succès > 80%
- Latence moyenne < 3s
- Score qualité moyen > 70/100

❌ **NO-GO** si :
- Taux de succès < 60%
- Latence moyenne > 5s
- Nombreuses erreurs de calcul

### Exemples de Résultats Attendus

**Bon modèle** :
```
✅ Passed: 18/20 (90%)
⏱️  Average latency: 1.8s
⭐ Average quality: 85/100
```

**Modèle insuffisant** :
```
❌ Failed: 12/20 (60%)
⏱️  Average latency: 4.2s
⭐ Average quality: 55/100
```

## Tester Vos Propres Prompts

### Via Python

```python
from backend.llm_engine import LLMEngine
from backend.trajectory_engine import TrajectoryEngine

engine = LLMEngine()
result = engine.generate_trajectory("spiral rising over 10 seconds")

traj_engine = TrajectoryEngine(result)
trajectory = traj_engine.generate_trajectory(fps=60)
```

### Via Visualisateur

1. Lancer le serveur : `python3 -m http.server 8000`
2. Ouvrir http://localhost:8000/visualization/visualizer.html
3. Coller le JSON généré
4. Cliquer "Load Trajectory"
5. Appuyer sur Play

## Modèles Recommandés à Tester

| Modèle | Taille | Force | Faiblesse |
|--------|--------|-------|-----------|
| `qwen2.5-coder:7b` | 7B | Excellent pour code/math | Peut manquer de créativité |
| `deepseek-r1:7b` | 7B | Raisonnement avancé | Plus lent |
| `llama3.1:8b` | 8B | Polyvalent | Moins précis en math |
| `qwen2.5:14b` | 14B | Meilleure qualité | Nécessite plus de RAM |

## Troubleshooting

### Ollama ne démarre pas
```bash
sudo systemctl start ollama
```

### Modèle trop lent (CPU)
- Utiliser un modèle plus petit : `ollama pull qwen2.5-coder:3b`
- Ou installer sur machine avec GPU

### Erreurs de parsing JSON
- Le modèle peut générer du texte avant/après le JSON
- Le parser nettoie automatiquement les balises ```json
- Si échec persistant, essayer un autre modèle

### Trajectoires invalides
- Vérifier les équations dans `results/*.json`
- Certains prompts complexes peuvent échouer
- Reformuler le prompt plus simplement

## Prochaines Étapes

Après validation du POC :

1. **Si GO** : Développer l'application complète (voir README.md)
2. **Si NO-GO** : 
   - Tester d'autres modèles
   - Améliorer le prompt engineering
   - Considérer approche hybride (local + cloud fallback)

## Support

Pour questions/bugs : créer une issue sur GitHub
