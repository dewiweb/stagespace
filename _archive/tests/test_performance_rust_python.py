"""Performance comparison: Rust core vs Python engine."""

import sys
import os
import time
import asyncio
import json
import statistics

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
import math_engine
import rust_core_client


def test_python_engine_performance():
    """Measure Python engine trajectory generation time."""
    engines = ["circular", "spiral", "lissajous", "figure8", "linear"]
    results = {}
    
    for engine in engines:
        start = time.perf_counter()
        for _ in range(100):
            getattr(math_engine, engine)(
                n_objects=4,
                duration=10.0,
                fps=60,
            )
        elapsed = time.perf_counter() - start
        results[engine] = elapsed * 1000  # ms
    
    return results


async def test_rust_engine_performance():
    """Measure Rust core trajectory evaluation time via IPC."""
    # Start Rust core
    rust_core_client.start_rust_core()
    client = rust_core_client.RustCoreClient()
    
    # Wait for startup
    await asyncio.sleep(1)
    
    engines = ["circular", "spiral", "lissajous", "figure8", "linear"]
    results = {}
    
    for engine in engines:
        start = time.perf_counter()
        for _ in range(100):
            await client.start_playback_async(
                session_id=f"perf-{engine}",
                trajectory_type=engine,
                params={
                    "speed": 1.0,
                    "scale_x": 1.0,
                    "scale_y": 1.0,
                    "scale_z": 1.0,
                    "shift_x": 0.0,
                    "shift_y": 0.0,
                    "shift_z": 0.0,
                    "turbulence": 0.0,
                    "n_objects": 4,
                    "duration": 10.0,
                },
                osc_host="127.0.0.1",
                osc_port=7788,
                osc_address_template="/track/{}/xyz",
                target_fps=60.0,
            )
            await client.stop_playback_async(f"perf-{engine}")
        elapsed = time.perf_counter() - start
        results[engine] = elapsed * 1000  # ms
    
    rust_core_client.stop_rust_core()
    return results


def compare_results(py_results, rust_results):
    """Print comparison table."""
    print("\n" + "="*70)
    print("PERFORMANCE COMPARISON: Python vs Rust (100 iterations)")
    print("="*70)
    print(f"{'Engine':<15} {'Python (ms)':<15} {'Rust (ms)':<15} {'Speedup':<15}")
    print("-"*70)
    
    for engine in py_results:
        py_time = py_results[engine]
        rust_time = rust_results.get(engine, 0)
        speedup = py_time / rust_time if rust_time > 0 else 0
        print(f"{engine:<15} {py_time:<15.2f} {rust_time:<15.2f} {speedup:<15.2f}x")
    
    print("-"*70)
    
    avg_py = statistics.mean(py_results.values())
    avg_rust = statistics.mean(rust_results.values())
    avg_speedup = avg_py / avg_rust if avg_rust > 0 else 0
    
    print(f"{'AVERAGE':<15} {avg_py:<15.2f} {avg_rust:<15.2f} {avg_speedup:<15.2f}x")
    print("="*70)


if __name__ == "__main__":
    print("Testing Python engine performance...")
    py_results = test_python_engine_performance()
    
    print("\nTesting Rust engine performance...")
    rust_results = asyncio.run(test_rust_engine_performance())
    
    compare_results(py_results, rust_results)