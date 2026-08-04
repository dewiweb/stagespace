"""Manual integration test: call api.play directly with Rust backend."""

import socket
import struct
import time
import os
import sys
import asyncio

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend"))

import api
import rust_core_client

OSC_PORT = 7788


def decode_osc_message(data):
    null_pos = data.index(b"\x00")
    address = data[:null_pos].decode()
    pos = null_pos + 1
    while pos % 4 != 0:
        pos += 1
    type_tag_end = data.index(b"\x00", pos)
    type_tag = data[pos:type_tag_end].decode()
    pos = type_tag_end + 1
    while pos % 4 != 0:
        pos += 1
    args = []
    for tag in type_tag[1:]:
        if tag == "f":
            args.append(struct.unpack(">f", data[pos:pos+4])[0])
            pos += 4
    return address, args


async def main():
    print("Connecting to rust core...")
    api._rust_client = rust_core_client.RustCoreClient()
    print("Connected")
    
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp_socket.bind(("127.0.0.1", OSC_PORT))
    udp_socket.settimeout(2.0)
    
    req = api.PlayRequest(
        engine="circular",
        profile="holophonix",
        host="127.0.0.1",
        port=OSC_PORT,
        fps=60,
        loop=True,
        params={"n_objects": 1, "scale_x": 1.0, "scale_y": 1.0},
        use_rust=True,
    )
    
    print("Calling api.play...")
    response = await api.play(req)
    print("Play response:", response)
    assert response["backend"] == "rust"
    
    received = []
    end_time = time.time() + 1.0
    while time.time() < end_time:
        try:
            data, _ = udp_socket.recvfrom(1024)
            address, args = decode_osc_message(data)
            received.append((address, args))
        except socket.timeout:
            break
    
    print(f"Received {len(received)} OSC messages")
    assert len(received) > 0, "No OSC messages received"
    
    for address, args in received:
        assert address == "/track/1/xyz"
        assert len(args) == 3
    
    print("Calling api.stop...")
    stop_response = await api.stop(response["session_id"])
    print("Stop response:", stop_response)
    print("TEST PASSED")


if __name__ == "__main__":
    asyncio.run(main())