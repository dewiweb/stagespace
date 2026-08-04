"""Client for HOLOFLOW Rust Core via Unix socket IPC."""

import asyncio
import json
import os
import subprocess
import time
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger("stagespace.rust_core")

SOCKET_PATH = "/tmp/holoflow.sock"
RUST_CORE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "rust-core")


class RustCoreClient:
    """Communicate with the HOLOFLOW Rust Core server over Unix socket.
    
    Provides both sync and async interfaces. The async methods are preferred
    inside the FastAPI event loop.
    """

    def __init__(self, socket_path: str = SOCKET_PATH):
        self.socket_path = socket_path

    async def _send_and_receive(self, message: Dict[str, Any]) -> Dict[str, Any]:
        reader, writer = await asyncio.open_unix_connection(self.socket_path)
        try:
            data = json.dumps(message).encode() + b"\n"
            writer.write(data)
            await writer.drain()
            writer.write_eof()
            response = await reader.readline()
            return json.loads(response.decode().strip())
        finally:
            writer.close()
            await writer.wait_closed()

    async def start_playback_async(
        self,
        session_id: str,
        trajectory_type: str,
        params: Dict[str, Any],
        osc_host: str,
        osc_port: int,
        osc_address_template: str,
        target_fps: float,
    ) -> Dict[str, Any]:
        """Start a playback session in Rust core."""
        return await self._send_and_receive({
            "type": "StartPlayback",
            "session_id": session_id,
            "trajectory_type": trajectory_type,
            "params": params,
            "osc_host": osc_host,
            "osc_port": osc_port,
            "osc_address_template": osc_address_template,
            "target_fps": target_fps,
        })

    async def stop_playback_async(self, session_id: str) -> Dict[str, Any]:
        """Stop a playback session in Rust core."""
        return await self._send_and_receive({
            "type": "StopPlayback",
            "session_id": session_id,
        })

    async def update_params_async(self, session_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Update parameters on a running session."""
        return await self._send_and_receive({
            "type": "UpdateParams",
            "session_id": session_id,
            "params": params,
        })

    async def get_status_async(self, session_id: str) -> Dict[str, Any]:
        """Get status of a session."""
        return await self._send_and_receive({
            "type": "GetStatus",
            "session_id": session_id,
        })

    # Synchronous wrappers for non-async contexts / tests ----------------------

    def _sync_send_and_receive(self, message: Dict[str, Any]) -> Dict[str, Any]:
        import socket
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.connect(self.socket_path)
            s.sendall(json.dumps(message).encode() + b"\n")
            response = s.recv(8192).decode()
            return json.loads(response.strip())

    def start_playback(
        self,
        session_id: str,
        trajectory_type: str,
        params: Dict[str, Any],
        osc_host: str,
        osc_port: int,
        osc_address_template: str,
        target_fps: float,
    ) -> Dict[str, Any]:
        return self._sync_send_and_receive({
            "type": "StartPlayback",
            "session_id": session_id,
            "trajectory_type": trajectory_type,
            "params": params,
            "osc_host": osc_host,
            "osc_port": osc_port,
            "osc_address_template": osc_address_template,
            "target_fps": target_fps,
        })

    def stop_playback(self, session_id: str) -> Dict[str, Any]:
        return self._sync_send_and_receive({
            "type": "StopPlayback",
            "session_id": session_id,
        })


_rust_process: Optional[subprocess.Popen] = None


def start_rust_core() -> None:
    """Build and start the Rust core IPC server."""
    global _rust_process

    try:
        os.remove(SOCKET_PATH)
    except FileNotFoundError:
        pass

    logger.info("Building HOLOFLOW Rust core...")
    build = subprocess.run(
        ["cargo", "build", "--release"],
        cwd=RUST_CORE_DIR,
        check=True,
        capture_output=True,
        text=True,
    )
    if build.returncode != 0:
        raise RuntimeError(f"Rust core build failed:\n{build.stderr}")

    logger.info("Starting HOLOFLOW Rust core server...")
    binary = os.path.join(RUST_CORE_DIR, "target", "release", "holoflow-server")
    _rust_process = subprocess.Popen(
        [binary],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    for _ in range(100):
        if os.path.exists(SOCKET_PATH):
            logger.info("Rust core ready.")
            return
        if _rust_process.poll() is not None:
            stderr = _rust_process.stderr.read() if _rust_process.stderr else ""
            raise RuntimeError(f"Rust core exited early:\n{stderr}")
        time.sleep(0.05)

    raise RuntimeError("Rust core did not create socket in time")


def stop_rust_core() -> None:
    """Stop the Rust core IPC server."""
    global _rust_process
    if _rust_process:
        _rust_process.terminate()
        try:
            _rust_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _rust_process.kill()
        _rust_process = None
    try:
        os.remove(SOCKET_PATH)
    except FileNotFoundError:
        pass