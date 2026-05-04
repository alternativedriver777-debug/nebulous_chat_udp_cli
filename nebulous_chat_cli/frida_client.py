from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import frida

from .colors import format_chat_message
from .console import print_error

_chat_logger: Any | None = None


def set_chat_logger(logger: Any | None) -> None:
    global _chat_logger
    _chat_logger = logger


def on_message(message: dict[str, Any], data: Any) -> None:
    msg_type = message.get("type")

    if msg_type == "log":
        payload = message.get("payload", "")
        level = message.get("level", "info")
        if level == "error":
            print_error(str(payload))
        else:
            print(str(payload))
        return

    if msg_type == "send":
        payload = message.get("payload")
        if isinstance(payload, dict):
            if payload.get("type") == "chat_message" and isinstance(payload.get("payload"), dict):
                chat_payload = payload["payload"]
                if _chat_logger is not None:
                    _chat_logger.log_incoming(chat_payload)
                print(format_chat_message(chat_payload))
            elif "line" in payload:
                print(str(payload["line"]))
            else:
                print("[agent]", json.dumps(payload, ensure_ascii=False))
        else:
            print("[agent]", payload)
        return

    if msg_type == "error":
        print_error(message.get("description", "Frida script error"))
        stack = message.get("stack")
        if stack:
            print(stack)
        return

    print("[frida]", message)


def load_agent_source(agent_file: Path) -> str:
    if not agent_file.exists():
        raise FileNotFoundError(f"Agent file not found: {agent_file}")

    return agent_file.read_text(encoding="utf-8")


def get_rpc(script: Any) -> Any:
    rpc = getattr(script, "exports_sync", None)
    if rpc is not None:
        return rpc

    return script.exports


@dataclass
class FridaConnection:
    session: Any
    script: Any
    rpc: Any

    def close(self) -> None:
        if self.script is not None:
            try:
                self.script.unload()
            except Exception:
                pass

        if self.session is not None:
            try:
                self.session.detach()
            except Exception:
                pass


def find_device_by_id(
    device_id: str,
    timeout: float = 8,
    poll_interval: float = 0.25,
    manager: Any | None = None,
    sleep: Any = time.sleep,
) -> Any:
    device_manager = manager or frida.get_device_manager()
    deadline = time.monotonic() + timeout
    available_ids: list[str] = []

    while True:
        devices = list(device_manager.enumerate_devices())
        available_ids = [str(getattr(device, "id", "")) for device in devices]

        for device in devices:
            if getattr(device, "id", None) == device_id:
                return device

        if time.monotonic() >= deadline:
            break

        sleep(min(poll_interval, max(0.0, deadline - time.monotonic())))

    available = ", ".join(available_ids) if available_ids else "none"
    raise RuntimeError(f"Frida device {device_id!r} was not found; available devices: {available}")


def select_device(device_id: str | None = None, timeout: float = 8) -> Any:
    if device_id:
        return find_device_by_id(device_id, timeout=timeout)

    return frida.get_usb_device(timeout=timeout)


def connect(
    process_name: str,
    agent_source: str,
    timeout: float = 8,
    device_id: str | None = None,
) -> FridaConnection:
    device = select_device(device_id=device_id, timeout=timeout)
    session = device.attach(process_name)
    script = session.create_script(agent_source)
    script.on("message", on_message)
    script.load()

    return FridaConnection(session=session, script=script, rpc=get_rpc(script))
