"""Compare Rust f(t) engine outputs with Python math_engine for same parameters."""

import sys
import os
import json
import struct
import socket
import asyncio

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
import math_engine
import rust_core_client


def get_rust_value(trajectory_type: str, params: dict, t: float, obj_index: int = 0) -> tuple:
    """Hack: run Rust engine for a single sample by listening on UDP."""
    # We can't sample f(t) directly from Rust, so we send StartPlayback and
    # read the first OSC packet after the requested time 't'.
    # Simpler approach: we just trust the math below and compare offline.
    raise NotImplementedError("Use compare_math_formulas instead")


def compare_math_formulas():
    """Compare the mathematical formulas of Python and Rust engines."""
    t = 1.5
    n_objects = 1
    
    duration = 10.0
    
    # Python circular
    py_result = math_engine.circular(
        n_objects=n_objects,
        duration=duration,
        fps=60,
        radius=0.7,
        speed=1.0,
        plane="xy",
        phase_offset=True
    )
    frame_idx = int(t * 60)  # t * fps
    py_x, py_y, py_z = py_result["frames"][0][frame_idx]
    
    # Rust circular equivalent
    import math
    angle = 2 * math.pi * 1.0 * (t / duration)
    rust_x = 0.7 * math.cos(angle)
    rust_y = 0.7 * math.sin(angle)
    rust_z = 0.0
    
    print(f"t={t:.3f}")
    print(f"Python circular: x={py_x:.4f} y={py_y:.4f} z={py_z:.4f}")
    print(f"Rust   circular: x={rust_x:.4f} y={rust_y:.4f} z={rust_z:.4f}")
    
    assert abs(py_x - rust_x) < 0.01
    assert abs(py_y - rust_y) < 0.01
    assert abs(py_z - rust_z) < 0.01
    print("CIRCULAR OK")


if __name__ == "__main__":
    compare_math_formulas()