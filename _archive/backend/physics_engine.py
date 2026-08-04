"""
Physics Engine — Simulations physiques NumPy pour OSCAI.

Chaque simulateur retourne le même format que math_engine :
positions de shape (N_objects, N_frames, 3) packagé dans un dict standard.
"""

import numpy as np
from typing import Dict, Any, List, Optional


# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────

def _result(positions: np.ndarray, duration: float, fps: int, meta: Dict) -> Dict[str, Any]:
    n_obj, n_frames, _ = positions.shape
    return {
        "duration": duration,
        "fps": fps,
        "objects": list(range(1, n_obj + 1)),
        "frames": positions.tolist(),
        "description": meta.get("description", ""),
        "_metadata": {
            "method": "physics_engine",
            "engine": meta.get("engine", "unknown"),
            "n_objects": n_obj,
            "n_frames": n_frames,
        }
    }


# ─────────────────────────────────────────────
#  1. REBONDS DANS UN CONTENANT
# ─────────────────────────────────────────────

def bouncing(n_objects: int = 4, duration: float = 10.0, fps: int = 60,
             container: str = "sphere", container_size: float = 0.9,
             restitution: float = 0.95, gravity: float = 0.0,
             seed: int = 42) -> Dict[str, Any]:
    """
    Objets rebondissant dans un contenant (sphère, boîte, cylindre).
    restitution: coefficient de restitution [0=inélastique, 1=élastique]
    gravity: accélération gravitationnelle (0 = apesanteur)
    """
    dt = 1.0 / fps
    n_frames = int(duration * fps)
    rng = np.random.RandomState(seed)

    pos = rng.uniform(-container_size * 0.5, container_size * 0.5, (n_objects, 3))
    vel = rng.uniform(-0.3, 0.3, (n_objects, 3))
    vel[:, 2] = 0.0  # départ horizontal

    positions = np.zeros((n_objects, n_frames, 3))

    for f in range(n_frames):
        positions[:, f, :] = pos

        # Gravité
        vel[:, 2] -= gravity * dt * 0.01

        pos += vel * dt

        # Collisions avec le contenant
        if container == "sphere":
            dist = np.linalg.norm(pos, axis=1, keepdims=True)
            outside = (dist > container_size).flatten()
            if outside.any():
                for i in np.where(outside)[0]:
                    n = pos[i] / (np.linalg.norm(pos[i]) + 1e-9)
                    pos[i] = n * container_size
                    vel[i] = vel[i] - 2 * np.dot(vel[i], n) * n
                    vel[i] *= restitution

        elif container == "box":
            for ax in range(3):
                outside_pos = pos[:, ax] > container_size
                outside_neg = pos[:, ax] < -container_size
                pos[outside_pos, ax] = container_size
                pos[outside_neg, ax] = -container_size
                vel[outside_pos, ax] *= -restitution
                vel[outside_neg, ax] *= -restitution

        elif container == "cylinder":
            # Cylindre vertical (collision XY uniquement + Z box)
            r_xy = np.linalg.norm(pos[:, :2], axis=1)
            outside = r_xy > container_size
            for i in np.where(outside)[0]:
                n = np.append(pos[i, :2] / (r_xy[i] + 1e-9), 0)
                pos[i, :2] = n[:2] * container_size
                vel[i] -= 2 * np.dot(vel[i], n) * n
                vel[i] *= restitution
            for ax in [2]:
                pos[pos[:, ax] > container_size, ax] = container_size
                pos[pos[:, ax] < -container_size, ax] = -container_size
                vel[pos[:, ax] >= container_size, ax] *= -restitution
                vel[pos[:, ax] <= -container_size, ax] *= -restitution

    return _result(positions, duration, fps, {
        "description": f"{n_objects} objects bouncing in {container} (r={container_size}, e={restitution})",
        "engine": "bouncing"
    })


# ─────────────────────────────────────────────
#  2. ÉVITEMENT MUTUEL
# ─────────────────────────────────────────────

def avoidance(n_objects: int = 4, duration: float = 10.0, fps: int = 60,
              repulsion_radius: float = 0.4, repulsion_strength: float = 2.0,
              damping: float = 0.95, container_size: float = 0.9,
              seed: int = 42) -> Dict[str, Any]:
    """
    Objets qui s'évitent mutuellement via force de répulsion.
    """
    dt = 1.0 / fps
    n_frames = int(duration * fps)
    rng = np.random.RandomState(seed)

    # Initialisation en cercle avec perturbation
    pos = np.zeros((n_objects, 3))
    for i in range(n_objects):
        angle = 2 * np.pi * i / n_objects
        pos[i, 0] = 0.6 * np.cos(angle) + rng.uniform(-0.05, 0.05)
        pos[i, 1] = 0.6 * np.sin(angle) + rng.uniform(-0.05, 0.05)
    vel = rng.uniform(-0.05, 0.05, (n_objects, 3))
    vel[:, 2] = 0

    positions = np.zeros((n_objects, n_frames, 3))

    for f in range(n_frames):
        positions[:, f, :] = pos
        forces = np.zeros((n_objects, 3))

        for i in range(n_objects):
            for j in range(n_objects):
                if i == j:
                    continue
                diff = pos[i] - pos[j]
                dist = np.linalg.norm(diff) + 1e-9
                if dist < repulsion_radius:
                    forces[i] += (repulsion_strength / dist**2) * (diff / dist)

        vel += forces * dt
        vel *= damping

        pos += vel * dt

        # Contenir dans une boîte
        for ax in range(3):
            over = np.abs(pos[:, ax]) > container_size
            pos[over, ax] = np.sign(pos[over, ax]) * container_size
            vel[over, ax] *= -0.8

    return _result(positions, duration, fps, {
        "description": f"{n_objects} objects avoiding each other (radius={repulsion_radius})",
        "engine": "avoidance"
    })


# ─────────────────────────────────────────────
#  3. RESSORT / ATTRACTION
# ─────────────────────────────────────────────

def spring(n_objects: int = 4, duration: float = 10.0, fps: int = 60,
           target: list = None, stiffness: float = 3.0,
           damping_coef: float = 0.5, seed: int = 42) -> Dict[str, Any]:
    """
    Objets attirés vers une cible par un ressort (masse-ressort amorti).
    La cible peut être fixe ou animée circulairement.
    """
    dt = 1.0 / fps
    n_frames = int(duration * fps)
    rng = np.random.RandomState(seed)
    t_arr = np.linspace(0, duration, n_frames)

    pos = rng.uniform(-0.8, 0.8, (n_objects, 3))
    vel = np.zeros((n_objects, 3))

    positions = np.zeros((n_objects, n_frames, 3))

    for f in range(n_frames):
        positions[:, f, :] = pos
        t = t_arr[f]

        if target is None:
            # Cible animée en cercle
            tgt = np.array([0.5 * np.cos(2 * np.pi * t / duration),
                            0.5 * np.sin(2 * np.pi * t / duration),
                            0.2 * np.sin(4 * np.pi * t / duration)])
        else:
            tgt = np.array(target)

        for i in range(n_objects):
            offset = np.array([0.1 * np.cos(2 * np.pi * i / n_objects),
                               0.1 * np.sin(2 * np.pi * i / n_objects),
                               0.05 * i / n_objects])
            tgt_i = np.clip(tgt + offset, -1, 1)
            force = stiffness * (tgt_i - pos[i]) - damping_coef * vel[i]
            vel[i] += force * dt
            pos[i] += vel[i] * dt
            pos[i] = np.clip(pos[i], -1, 1)

    return _result(positions, duration, fps, {
        "description": f"{n_objects} objects on spring (k={stiffness}, damp={damping_coef})",
        "engine": "spring"
    })


# ─────────────────────────────────────────────
#  4. FOLLOW (file indienne)
# ─────────────────────────────────────────────

def follow(n_objects: int = 4, duration: float = 10.0, fps: int = 60,
           leader_path: str = "circular", leader_radius: float = 0.7,
           follow_delay: float = 0.5, follow_strength: float = 5.0) -> Dict[str, Any]:
    """
    Objets qui suivent un leader avec un délai (file indienne).
    leader_path: circular | lissajous | figure8
    """
    dt = 1.0 / fps
    n_frames = int(duration * fps)
    t_arr = np.linspace(0, duration, n_frames)

    # Calculer le chemin du leader
    leader = np.zeros((n_frames, 3))
    omega = 2 * np.pi / duration

    if leader_path == "circular":
        leader[:, 0] = leader_radius * np.cos(2 * omega * t_arr)
        leader[:, 1] = leader_radius * np.sin(2 * omega * t_arr)
    elif leader_path == "lissajous":
        leader[:, 0] = leader_radius * np.sin(3 * omega * t_arr)
        leader[:, 1] = leader_radius * np.sin(2 * omega * t_arr + np.pi / 2)
        leader[:, 2] = 0.3 * np.sin(omega * t_arr)
    elif leader_path == "figure8":
        a = omega * t_arr
        denom = 1 + np.sin(a)**2
        leader[:, 0] = leader_radius * np.cos(a) / denom
        leader[:, 1] = leader_radius * np.sin(a) * np.cos(a) / denom

    # Construire la file
    positions = np.zeros((n_objects, n_frames, 3))
    positions[0] = leader

    delay_frames = int(follow_delay * fps)

    for i in range(1, n_objects):
        pos = leader[0].copy()
        vel = np.zeros(3)
        total_delay = i * delay_frames

        for f in range(n_frames):
            target_f = max(0, f - total_delay)
            target = positions[i - 1, target_f]
            force = follow_strength * (target - pos)
            vel = vel * 0.85 + force * dt
            pos = np.clip(pos + vel * dt, -1, 1)
            positions[i, f] = pos

    return _result(positions, duration, fps, {
        "description": f"Follow chain: {n_objects} objects, leader={leader_path}, delay={follow_delay}s",
        "engine": "follow"
    })


# ─────────────────────────────────────────────
#  5. SWARM (essaim)
# ─────────────────────────────────────────────

def swarm(n_objects: int = 8, duration: float = 10.0, fps: int = 60,
          cohesion: float = 0.5, separation: float = 1.5,
          alignment: float = 0.3, speed: float = 0.3,
          container_size: float = 0.85, seed: int = 42) -> Dict[str, Any]:
    """
    Simulation d'essaim (règles de Boids de Craig Reynolds) :
    - Cohésion : se rapprocher du centre de masse
    - Séparation : éviter les voisins trop proches
    - Alignement : s'aligner avec la direction des voisins
    """
    dt = 1.0 / fps
    n_frames = int(duration * fps)
    rng = np.random.RandomState(seed)

    pos = rng.uniform(-0.7, 0.7, (n_objects, 3))
    pos[:, 2] *= 0.3  # Démarrer à peu près au même plan vertical
    vel = rng.uniform(-speed, speed, (n_objects, 3)) * 0.5
    vel[:, 2] *= 0.2

    sep_radius = 0.25
    positions = np.zeros((n_objects, n_frames, 3))

    for f in range(n_frames):
        positions[:, f, :] = pos
        new_vel = vel.copy()

        center = pos.mean(axis=0)

        for i in range(n_objects):
            coh = np.zeros(3)
            sep = np.zeros(3)
            ali = np.zeros(3)
            n_neighbors = 0

            for j in range(n_objects):
                if i == j:
                    continue
                diff = pos[j] - pos[i]
                dist = np.linalg.norm(diff) + 1e-9

                if dist < sep_radius:
                    sep -= diff / dist**2

                if dist < 0.6:
                    coh += diff
                    ali += vel[j]
                    n_neighbors += 1

            if n_neighbors > 0:
                coh /= n_neighbors
                ali /= n_neighbors

            # Centre global pull (empêche les objets de s'envoler)
            global_pull = (center - pos[i]) * 0.1

            force = (cohesion * coh + separation * sep + alignment * ali + global_pull)
            new_vel[i] = vel[i] + force * dt

            # Limiter la vitesse
            v_norm = np.linalg.norm(new_vel[i])
            if v_norm > speed:
                new_vel[i] = new_vel[i] / v_norm * speed

        vel = new_vel
        pos += vel * dt

        # Contenir
        for ax in range(3):
            over = np.abs(pos[:, ax]) > container_size
            pos[over, ax] = np.sign(pos[over, ax]) * container_size
            vel[over, ax] *= -0.6

    return _result(positions, duration, fps, {
        "description": f"Swarm ({n_objects} boids, coh={cohesion}, sep={separation}, ali={alignment})",
        "engine": "swarm"
    })


# ─────────────────────────────────────────────
#  Registre
# ─────────────────────────────────────────────

ENGINES: Dict[str, callable] = {
    "bouncing":   bouncing,
    "avoidance":  avoidance,
    "spring":     spring,
    "follow":     follow,
    "swarm":      swarm,
}


if __name__ == "__main__":
    import time
    print("=== Physics Engine Tests ===\n")
    for name, fn in ENGINES.items():
        start = time.perf_counter()
        result = fn(n_objects=4, duration=5.0, fps=60)
        elapsed = time.perf_counter() - start
        frames = result['_metadata']['n_frames']
        desc = result['description'][:55]
        print(f"  {name:12s}  {elapsed*1000:7.1f}ms  {frames} frames  '{desc}'")
