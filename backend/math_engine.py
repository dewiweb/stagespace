"""
Math Engine — Générateur de trajectoires mathématiques pures.

Chaque fonction retourne un tableau numpy de shape (N_objects, N_frames, 3)
où 3 = (x, y, z) en coordonnées cartésiennes normalisées [-1, 1].
"""

import numpy as np
from typing import Dict, Any

# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────

def _frames(duration: float, fps: int = 60) -> np.ndarray:
    return np.linspace(0, duration, int(duration * fps))


def _result(positions: np.ndarray, duration: float, fps: int, meta: Dict) -> Dict[str, Any]:
    """Formate la sortie standard."""
    n_obj, n_frames, _ = positions.shape
    return {
        "duration": duration,
        "fps": fps,
        "objects": list(range(1, n_obj + 1)),
        "frames": positions.tolist(),          # [obj][frame][x,y,z]
        "description": meta.get("description", ""),
        "_metadata": {
            "method": "math_engine",
            "engine": meta.get("engine", "unknown"),
            "n_objects": n_obj,
            "n_frames": n_frames,
        }
    }


# ─────────────────────────────────────────────
#  1. CIRCULAIRE
# ─────────────────────────────────────────────

def circular(n_objects: int = 1, duration: float = 10.0, fps: int = 60,
             radius: float = 0.7, speed: float = 1.0,
             plane: str = "xy", phase_offset: bool = True) -> Dict[str, Any]:
    """Mouvement circulaire uniforme dans un plan."""
    t = _frames(duration, fps)
    positions = np.zeros((n_objects, len(t), 3))

    for i in range(n_objects):
        phase = (2 * np.pi * i / n_objects) if phase_offset else 0.0
        angle = 2 * np.pi * speed * t / duration + phase
        if plane == "xy":
            positions[i, :, 0] = radius * np.cos(angle)
            positions[i, :, 1] = radius * np.sin(angle)
        elif plane == "xz":
            positions[i, :, 0] = radius * np.cos(angle)
            positions[i, :, 2] = radius * np.sin(angle)
        elif plane == "yz":
            positions[i, :, 1] = radius * np.cos(angle)
            positions[i, :, 2] = radius * np.sin(angle)

    return _result(positions, duration, fps, {
        "description": f"{n_objects} object(s) in circular motion (r={radius}, plane={plane})",
        "engine": "circular"
    })


# ─────────────────────────────────────────────
#  2. SPIRALE
# ─────────────────────────────────────────────

def spiral(n_objects: int = 1, duration: float = 10.0, fps: int = 60,
           start_radius: float = 0.1, end_radius: float = 0.9,
           start_z: float = -0.8, end_z: float = 0.8,
           turns: float = 3.0, phase_offset: bool = True) -> Dict[str, Any]:
    """Spirale hélicoïdale montante ou descendante."""
    t = _frames(duration, fps)
    tn = t / duration                           # [0, 1]
    positions = np.zeros((n_objects, len(t), 3))

    for i in range(n_objects):
        phase = (2 * np.pi * i / n_objects) if phase_offset else 0.0
        r = start_radius + (end_radius - start_radius) * tn
        angle = 2 * np.pi * turns * tn + phase
        positions[i, :, 0] = r * np.cos(angle)
        positions[i, :, 1] = r * np.sin(angle)
        positions[i, :, 2] = start_z + (end_z - start_z) * tn

    return _result(positions, duration, fps, {
        "description": f"Spiral: r {start_radius}→{end_radius}, z {start_z}→{end_z}, {turns} turns",
        "engine": "spiral"
    })


# ─────────────────────────────────────────────
#  3. LISSAJOUS
# ─────────────────────────────────────────────

def lissajous(n_objects: int = 1, duration: float = 10.0, fps: int = 60,
              freq_x: float = 3.0, freq_y: float = 2.0, freq_z: float = 1.0,
              amp_x: float = 0.8, amp_y: float = 0.8, amp_z: float = 0.4,
              phase_x: float = 0.0, phase_y: float = np.pi / 2,
              phase_offset: bool = True) -> Dict[str, Any]:
    """Courbes de Lissajous 3D — patterns complexes déterministes."""
    t = _frames(duration, fps)
    positions = np.zeros((n_objects, len(t), 3))
    omega = 2 * np.pi / duration

    for i in range(n_objects):
        po = (2 * np.pi * i / n_objects) if phase_offset else 0.0
        positions[i, :, 0] = amp_x * np.sin(freq_x * omega * t + phase_x + po)
        positions[i, :, 1] = amp_y * np.sin(freq_y * omega * t + phase_y + po)
        positions[i, :, 2] = amp_z * np.sin(freq_z * omega * t + po)

    return _result(positions, duration, fps, {
        "description": f"Lissajous 3D ({freq_x}:{freq_y}:{freq_z})",
        "engine": "lissajous"
    })


# ─────────────────────────────────────────────
#  4. FIGURE-8
# ─────────────────────────────────────────────

def figure8(n_objects: int = 1, duration: float = 10.0, fps: int = 60,
            size: float = 0.7, plane: str = "xy",
            phase_offset: bool = True) -> Dict[str, Any]:
    """Lemniscate de Bernoulli (figure en 8)."""
    t = _frames(duration, fps)
    positions = np.zeros((n_objects, len(t), 3))
    omega = 2 * np.pi / duration

    for i in range(n_objects):
        po = (2 * np.pi * i / n_objects) if phase_offset else 0.0
        a = omega * t + po
        denom = 1 + np.sin(a) ** 2
        x = size * np.cos(a) / denom
        y = size * np.sin(a) * np.cos(a) / denom
        if plane == "xy":
            positions[i, :, 0] = x
            positions[i, :, 1] = y
        elif plane == "xz":
            positions[i, :, 0] = x
            positions[i, :, 2] = y
        elif plane == "yz":
            positions[i, :, 1] = x
            positions[i, :, 2] = y

    return _result(positions, duration, fps, {
        "description": f"Figure-8 lemniscate (size={size}, plane={plane})",
        "engine": "figure8"
    })


# ─────────────────────────────────────────────
#  5. LINÉAIRE
# ─────────────────────────────────────────────

def linear(n_objects: int = 1, duration: float = 10.0, fps: int = 60,
           start: list = None, end: list = None,
           pingpong: bool = False) -> Dict[str, Any]:
    """Mouvement linéaire entre deux points, avec option ping-pong."""
    if start is None:
        start = [-0.8, 0.0, 0.0]
    if end is None:
        end = [0.8, 0.0, 0.0]

    t = _frames(duration, fps)
    tn = t / duration
    if pingpong:
        tn = 1 - np.abs(2 * tn - 1)

    positions = np.zeros((n_objects, len(t), 3))
    s, e = np.array(start), np.array(end)

    for i in range(n_objects):
        offset = i / max(n_objects - 1, 1)
        stagger = np.clip(tn - offset * 0.3, 0, 1)
        stagger = stagger / stagger.max() if stagger.max() > 0 else stagger
        for ax in range(3):
            positions[i, :, ax] = s[ax] + (e[ax] - s[ax]) * stagger

    return _result(positions, duration, fps, {
        "description": f"Linear {start}→{end}" + (" pingpong" if pingpong else ""),
        "engine": "linear"
    })


# ─────────────────────────────────────────────
#  6. OSCILLATION
# ─────────────────────────────────────────────

def oscillation(n_objects: int = 1, duration: float = 10.0, fps: int = 60,
                axis: str = "z", amplitude: float = 0.7,
                frequency: float = 2.0, damping: float = 0.0,
                phase_offset: bool = True) -> Dict[str, Any]:
    """Oscillation sinusoïdale sur un axe, avec amortissement optionnel."""
    t = _frames(duration, fps)
    positions = np.zeros((n_objects, len(t), 3))
    ax_idx = {"x": 0, "y": 1, "z": 2}[axis]
    omega = 2 * np.pi * frequency

    for i in range(n_objects):
        po = (2 * np.pi * i / n_objects) if phase_offset else 0.0
        env = np.exp(-damping * t / duration) if damping > 0 else 1.0
        positions[i, :, ax_idx] = amplitude * env * np.sin(omega * t / duration + po)

    return _result(positions, duration, fps, {
        "description": f"Oscillation on {axis}, amp={amplitude}, freq={frequency}Hz, damp={damping}",
        "engine": "oscillation"
    })


# ─────────────────────────────────────────────
#  7. BRUIT DE PERLIN (approx. par superposition harmonique)
# ─────────────────────────────────────────────

def perlin_noise(n_objects: int = 1, duration: float = 10.0, fps: int = 60,
                 intensity: float = 0.5, smoothness: float = 0.5,
                 seed: int = 42) -> Dict[str, Any]:
    """
    Mouvement organique par superposition de sinusoïdes harmoniques
    (approximation déterministe du bruit de Perlin).
    """
    rng = np.random.RandomState(seed)
    t = _frames(duration, fps)
    positions = np.zeros((n_objects, len(t), 3))

    # Nombre d'harmoniques selon smoothness : peu = lisse, beaucoup = chaotique
    n_harmonics = max(3, int(12 * (1 - smoothness)))
    base_freq = 1.0 / duration

    for i in range(n_objects):
        obj_seed = seed + i * 31
        rng_i = np.random.RandomState(obj_seed)
        for ax in range(3):
            signal = np.zeros(len(t))
            for h in range(1, n_harmonics + 1):
                freq = base_freq * h * (1 + 0.2 * rng_i.randn())
                amp = intensity / (h ** (0.5 + smoothness))
                phase = rng_i.uniform(0, 2 * np.pi)
                signal += amp * np.sin(2 * np.pi * freq * t + phase)
            # Normaliser dans [-1, 1]
            m = np.max(np.abs(signal))
            if m > 0:
                signal = signal / m * intensity
            positions[i, :, ax] = np.clip(signal, -1, 1)

    return _result(positions, duration, fps, {
        "description": f"Perlin-like noise (intensity={intensity}, smoothness={smoothness})",
        "engine": "perlin_noise"
    })


# ─────────────────────────────────────────────
#  8. FORMATION
# ─────────────────────────────────────────────

def formation(n_objects: int = 8, duration: float = 10.0, fps: int = 60,
              shape: str = "circle", radius: float = 0.7,
              rotate: float = 0.0, elevation: float = 0.0) -> Dict[str, Any]:
    """
    Objets fixes en formation géométrique.
    shapes: circle | grid | sphere | line | triangle | hexagon
    rotate: vitesse de rotation en tours/seconde
    """
    t = _frames(duration, fps)
    positions = np.zeros((n_objects, len(t), 3))

    if shape == "circle":
        for i in range(n_objects):
            base_angle = 2 * np.pi * i / n_objects
            angle = base_angle + 2 * np.pi * rotate * t / duration
            positions[i, :, 0] = radius * np.cos(angle)
            positions[i, :, 1] = radius * np.sin(angle)
            positions[i, :, 2] = elevation

    elif shape == "sphere":
        # Distribution uniforme sur une sphère (Fibonacci)
        golden = np.pi * (3 - np.sqrt(5))
        for i in range(n_objects):
            y = 1 - (2 * i / max(n_objects - 1, 1))
            r = np.sqrt(1 - y * y) * radius
            theta = golden * i
            angle = theta + 2 * np.pi * rotate * t / duration
            positions[i, :, 0] = r * np.cos(angle)
            positions[i, :, 1] = r * np.sin(angle)
            positions[i, :, 2] = y * radius

    elif shape == "grid":
        side = int(np.ceil(np.sqrt(n_objects)))
        for i in range(n_objects):
            row, col = divmod(i, side)
            x = (col / max(side - 1, 1) - 0.5) * 2 * radius
            y = (row / max(side - 1, 1) - 0.5) * 2 * radius
            angle = 2 * np.pi * rotate * t / duration
            cx, cy = x * np.cos(angle) - y * np.sin(angle), x * np.sin(angle) + y * np.cos(angle)
            positions[i, :, 0] = cx
            positions[i, :, 1] = cy
            positions[i, :, 2] = elevation

    elif shape == "line":
        for i in range(n_objects):
            x = (i / max(n_objects - 1, 1) - 0.5) * 2 * radius
            angle = 2 * np.pi * rotate * t / duration
            positions[i, :, 0] = x * np.cos(angle)
            positions[i, :, 1] = x * np.sin(angle)
            positions[i, :, 2] = elevation

    return _result(positions, duration, fps, {
        "description": f"Formation: {n_objects} objects in {shape} (r={radius}, rotate={rotate})",
        "engine": "formation"
    })


# ─────────────────────────────────────────────
#  9. CONVERGENCE / DIVERGENCE
# ─────────────────────────────────────────────

def converge(n_objects: int = 8, duration: float = 10.0, fps: int = 60,
             start_radius: float = 0.9, end_radius: float = 0.0,
             shape: str = "circle", easing: str = "linear") -> Dict[str, Any]:
    """Objets qui convergent vers le centre (ou divergent si start < end)."""
    t = _frames(duration, fps)
    tn = t / duration

    if easing == "ease_in":
        tn = tn ** 2
    elif easing == "ease_out":
        tn = 1 - (1 - tn) ** 2
    elif easing == "smooth":
        tn = 3 * tn**2 - 2 * tn**3

    positions = np.zeros((n_objects, len(t), 3))
    for i in range(n_objects):
        base_angle = 2 * np.pi * i / n_objects
        r = start_radius + (end_radius - start_radius) * tn
        positions[i, :, 0] = r * np.cos(base_angle)
        positions[i, :, 1] = r * np.sin(base_angle)

    return _result(positions, duration, fps, {
        "description": f"Convergence r={start_radius}→{end_radius} ({n_objects} objects, {easing})",
        "engine": "converge"
    })


# ─────────────────────────────────────────────
#  10. PENDULE
# ─────────────────────────────────────────────

def pendulum(n_objects: int = 1, duration: float = 10.0, fps: int = 60,
             length: float = 0.8, gravity: float = 9.81,
             initial_angle: float = 0.5, damping: float = 0.05,
             phase_offset: bool = True) -> Dict[str, Any]:
    """
    Simulation de pendule (intégration numérique RK4).
    Mouvement non-linéaire réaliste.
    """
    dt = 1.0 / fps
    n_frames = int(duration * fps)
    positions = np.zeros((n_objects, n_frames, 3))

    for i in range(n_objects):
        po = (np.pi * i / n_objects) if phase_offset else 0.0
        theta = initial_angle + po * 0.1
        omega_p = 0.0
        omega_nat = np.sqrt(gravity / (length * 10))

        for f in range(n_frames):
            # RK4
            def deriv(th, om):
                return om, -damping * om - omega_nat**2 * np.sin(th)

            k1_th, k1_om = deriv(theta, omega_p)
            k2_th, k2_om = deriv(theta + 0.5*dt*k1_th, omega_p + 0.5*dt*k1_om)
            k3_th, k3_om = deriv(theta + 0.5*dt*k2_th, omega_p + 0.5*dt*k2_om)
            k4_th, k4_om = deriv(theta + dt*k3_th, omega_p + dt*k3_om)

            theta += dt * (k1_th + 2*k2_th + 2*k3_th + k4_th) / 6
            omega_p += dt * (k1_om + 2*k2_om + 2*k3_om + k4_om) / 6

            positions[i, f, 0] = np.clip(length * np.sin(theta), -1, 1)
            positions[i, f, 2] = np.clip(-length * np.cos(theta) + length * 0.5, -1, 1)

    return _result(positions, duration, fps, {
        "description": f"Pendulum (L={length}, g={gravity}, θ₀={initial_angle:.2f}, damp={damping})",
        "engine": "pendulum"
    })


# ─────────────────────────────────────────────
#  Registre
# ─────────────────────────────────────────────

ENGINES: Dict[str, callable] = {
    "circular":     circular,
    "spiral":       spiral,
    "lissajous":    lissajous,
    "figure8":      figure8,
    "linear":       linear,
    "oscillation":  oscillation,
    "perlin_noise": perlin_noise,
    "formation":    formation,
    "converge":     converge,
    "pendulum":     pendulum,
}


if __name__ == "__main__":
    import time
    print("=== Math Engine Tests ===\n")
    for name, fn in ENGINES.items():
        start = time.perf_counter()
        result = fn(n_objects=4, duration=5.0, fps=60)
        elapsed = time.perf_counter() - start
        frames = result['_metadata']['n_frames']
        desc = result['description'][:50]
        print(f"  {name:15s}  {elapsed*1000:6.2f}ms  {frames} frames  '{desc}'")
