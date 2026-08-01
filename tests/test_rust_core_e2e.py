"""
End-to-end test for HOLOFLOW Rust Core.

Starts the Rust IPC server, sends a StartPlayback message over Unix socket,
captures UDP OSC output, and verifies the expected trajectory messages.
"""

import socket
import json
import subprocess
import time
import os
import signal
import pytest
import struct

SOCKET_PATH = "/tmp/holoflow.sock"
OSC_PORT = 7777


def encode_osc_message(address, *args):
    """Encode a basic OSC message with float args."""
    # Pad address with nulls to multiple of 4
    addr_bytes = address.encode() + b"\x00"
    while len(addr_bytes) % 4 != 0:
        addr_bytes += b"\x00"
    
    # Type tag
    type_tag = "," + "f" * len(args)
    type_tag_bytes = type_tag.encode() + b"\x00"
    while len(type_tag_bytes) % 4 != 0:
        type_tag_bytes += b"\x00"
    
    # Arguments
    args_bytes = b""
    for arg in args:
        args_bytes += struct.pack(">f", float(arg))
    
    return addr_bytes + type_tag_bytes + args_bytes


def decode_osc_message(data):
    """Decode a basic OSC message into (address, [args...])."""
    # Find null terminator of address
    null_pos = data.index(b"\x00")
    address = data[:null_pos].decode()
    
    # Skip padding
    pos = null_pos + 1
    while pos % 4 != 0:
        pos += 1
    
    # Type tag
    type_tag_end = data.index(b"\x00", pos)
    type_tag = data[pos:type_tag_end].decode()
    pos = type_tag_end + 1
    while pos % 4 != 0:
        pos += 1
    
    args = []
    for tag in type_tag[1:]:  # Skip leading ','
        if tag == "f":
            args.append(struct.unpack(">f", data[pos:pos+4])[0])
            pos += 4
    
    return address, args


@pytest.fixture(scope="module")
def rust_server():
    """Start the Rust IPC server and clean up after tests."""
    # Remove old socket
    try:
        os.remove(SOCKET_PATH)
    except FileNotFoundError:
        pass
    
    # Build server
    build = subprocess.run(
        ["cargo", "build"],
        cwd="rust-core",
        check=True,
        capture_output=True,
        text=True
    )
    
    # Start server
    server = subprocess.Popen(
        ["cargo", "run", "--quiet"],
        cwd="rust-core",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    # Wait for socket to be created
    for _ in range(50):
        if os.path.exists(SOCKET_PATH):
            break
        time.sleep(0.1)
    else:
        server.terminate()
        raise RuntimeError("Rust server did not create socket in time")
    
    yield server
    
    # Cleanup
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
    
    try:
        os.remove(SOCKET_PATH)
    except FileNotFoundError:
        pass


def test_rust_core_sends_osc(rust_server):
    """Verify the Rust core sends OSC messages for a circular trajectory."""
    # Start a UDP listener for OSC output
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp_socket.bind(("127.0.0.1", OSC_PORT))
    udp_socket.settimeout(2.0)
    
    # Connect to IPC server
    ipc_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    ipc_socket.connect(SOCKET_PATH)
    
    # Send StartPlayback message
    start_msg = {
        "type": "StartPlayback",
        "session_id": "test-session",
        "trajectory_type": "circular",
        "params": {
            "speed": 1.0,
            "scale_x": 1.0,
            "scale_y": 1.0,
            "scale_z": 1.0,
            "shift_x": 0.0,
            "shift_y": 0.0,
            "shift_z": 0.0,
            "turbulence": 0.0,
            "n_objects": 1
        },
        "osc_host": "127.0.0.1",
        "osc_port": OSC_PORT,
        "osc_address_template": "/track/{}/xyz",
        "target_fps": 60.0
    }
    
    ipc_socket.sendall(json.dumps(start_msg).encode())
    response = ipc_socket.recv(4096).decode()
    response_data = json.loads(response)
    
    assert response_data.get("type") == "Response"
    assert response_data["success"] is True, f"StartPlayback failed: {response_data.get('error')}"
    
    # Receive OSC messages for 1 second
    received = []
    end_time = time.time() + 1.0
    while time.time() < end_time:
        try:
            data, _ = udp_socket.recvfrom(1024)
            address, args = decode_osc_message(data)
            received.append((address, args))
        except socket.timeout:
            break
    
    # Stop playback
    stop_msg = {
        "type": "StopPlayback",
        "session_id": "test-session"
    }
    ipc_socket.sendall(json.dumps(stop_msg).encode())
    ipc_socket.close()
    
    # Assertions
    assert len(received) > 0, "No OSC messages received"
    assert len(received) >= 30, f"Expected at least 30 OSC messages, got {len(received)}"
    
    for address, args in received:
        assert address == "/track/1/xyz"
        assert len(args) == 3
        assert all(isinstance(a, float) for a in args)
    
    # Verify trajectory is circular-ish (positions around unit circle)
    first_msg = received[0]
    x, y, z = first_msg[1]
    radius = (x**2 + y**2) ** 0.5
    assert 0.8 <= radius <= 1.2, f"Expected radius around 1.0, got {radius}"
    assert abs(z) < 0.1, f"Expected z near 0, got {z}"


def test_rust_core_status(rust_server):
    """Verify status endpoint works."""
    ipc_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    ipc_socket.connect(SOCKET_PATH)
    
    start_msg = {
        "type": "StartPlayback",
        "session_id": "status-session",
        "trajectory_type": "spiral",
        "params": {
            "speed": 1.0,
            "scale_x": 1.0,
            "scale_y": 1.0,
            "scale_z": 1.0,
            "shift_x": 0.0,
            "shift_y": 0.0,
            "shift_z": 0.0,
            "turbulence": 0.0,
            "n_objects": 1
        },
        "osc_host": "127.0.0.1",
        "osc_port": OSC_PORT,
        "osc_address_template": "/test/{}/xyz",
        "target_fps": 30.0
    }
    
    ipc_socket.sendall(json.dumps(start_msg).encode())
    response = ipc_socket.recv(4096).decode()
    response_data = json.loads(response)
    assert response_data["success"] is True
    
    status_msg = {
        "type": "GetStatus",
        "session_id": "status-session"
    }
    ipc_socket.sendall(json.dumps(status_msg).encode())
    response = ipc_socket.recv(4096).decode()
    response_data = json.loads(response)
    
    assert response_data["success"] is True
    assert response_data["data"]["running"] is True
    
    # Stop
    stop_msg = {
        "type": "StopPlayback",
        "session_id": "status-session"
    }
    ipc_socket.sendall(json.dumps(stop_msg).encode())
    ipc_socket.close()