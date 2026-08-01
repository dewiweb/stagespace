"""Test Rust core runtime timing stability (jitter measurement)."""

import sys
import os
import time
import socket
import struct
import statistics
import asyncio

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))
import rust_core_client


def receive_osc_messages(port=7788, duration_sec=5):
    """Receive OSC messages and measure inter-arrival times."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", port))
    sock.settimeout(0.1)
    
    timestamps = []
    start_time = time.time()
    
    while time.time() - start_time < duration_sec:
        try:
            data, _ = sock.recvfrom(1024)
            now = time.time()
            timestamps.append(now)
        except socket.timeout:
            continue
    
    sock.close()
    return timestamps


def calculate_jitter(timestamps):
    """Calculate jitter statistics from timestamps."""
    if len(timestamps) < 2:
        return {}
    
    intervals = [timestamps[i] - timestamps[i-1] for i in range(1, len(timestamps))]
    
    return {
        "count": len(intervals),
        "mean_interval": statistics.mean(intervals),
        "stddev": statistics.stdev(intervals) if len(intervals) > 1 else 0,
        "min": min(intervals),
        "max": max(intervals),
        "expected_interval": 1.0 / 60.0,  # 60 FPS
    }


async def test_rust_runtime_jitter():
    """Test Rust core runtime timing stability."""
    # Start Rust core
    rust_core_client.start_rust_core()
    client = rust_core_client.RustCoreClient()
    
    # Wait for startup
    await asyncio.sleep(1)
    
    # Start playback
    await client.start_playback_async(
        session_id="jitter-test",
        trajectory_type="circular",
        params={
            "speed": 1.0,
            "scale_x": 1.0,
            "scale_y": 1.0,
            "scale_z": 1.0,
            "shift_x": 0.0,
            "shift_y": 0.0,
            "shift_z": 0.0,
            "turbulence": 0.0,
            "n_objects": 1,
            "duration": 10.0,
        },
        osc_host="127.0.0.1",
        osc_port=7788,
        osc_address_template="/track/{}/xyz",
        target_fps=60.0,
    )
    
    # Receive messages for 5 seconds
    print("Receiving OSC messages for 5 seconds...")
    timestamps = receive_osc_messages(port=7788, duration_sec=5)
    
    # Stop playback
    await client.stop_playback_async("jitter-test")
    rust_core_client.stop_rust_core()
    
    # Calculate jitter
    stats = calculate_jitter(timestamps)
    
    print("\n" + "="*70)
    print("RUST CORE RUNTIME TIMING ANALYSIS")
    print("="*70)
    print(f"Messages received: {stats['count']}")
    print(f"Expected interval: {stats['expected_interval']*1000:.3f} ms (60 FPS)")
    print(f"Mean interval:     {stats['mean_interval']*1000:.3f} ms")
    print(f"Std deviation:     {stats['stddev']*1000:.3f} ms")
    print(f"Min interval:      {stats['min']*1000:.3f} ms")
    print(f"Max interval:      {stats['max']*1000:.3f} ms")
    print(f"Jitter (stddev):  {stats['stddev']*1000:.3f} ms")
    print("="*70)
    
    # Calculate FPS
    if stats['mean_interval'] > 0:
        actual_fps = 1.0 / stats['mean_interval']
        print(f"Actual FPS:        {actual_fps:.2f}")
        print("="*70)


if __name__ == "__main__":
    asyncio.run(test_rust_runtime_jitter())