from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, TextIO

from .config import CHAT_COLORS_FILE


RESET = "\033[0m"

COLOR_CODES = {
    "default": "39",
    "black": "30",
    "red": "31",
    "green": "32",
    "yellow": "33",
    "blue": "34",
    "magenta": "35",
    "cyan": "36",
    "white": "37",
    "bright_black": "90",
    "bright_red": "91",
    "bright_green": "92",
    "bright_yellow": "93",
    "bright_blue": "94",
    "bright_magenta": "95",
    "bright_cyan": "96",
    "bright_white": "97",
}

DEFAULT_CHAT_COLOR_CONFIG: dict[str, Any] = {
    "enabled": "auto",
    "chat": {
        "prefix": "yellow",
        "id": "green",
        "nick": "green",
        "message": "default",
    },
}


def load_chat_color_config(path: Path = CHAT_COLORS_FILE) -> dict[str, Any]:
    config = _deep_copy_default()

    if not path.exists():
        return config

    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return config

    if not isinstance(loaded, dict):
        return config

    enabled = loaded.get("enabled")
    if enabled in ("auto", "always", "never", True, False):
        config["enabled"] = enabled

    chat = loaded.get("chat")
    if isinstance(chat, dict):
        for key in ("prefix", "id", "nick", "message"):
            value = chat.get(key)
            if is_supported_color(value):
                config["chat"][key] = value

    return config


def is_supported_color(value: Any) -> bool:
    return value == "none" or value in COLOR_CODES


def should_use_color(
    enabled: Any = "auto",
    stream: TextIO | None = None,
    environ: dict[str, str] | None = None,
) -> bool:
    env = os.environ if environ is None else environ

    if "NO_COLOR" in env:
        return False

    if enabled is True or enabled == "always":
        return True

    if enabled is False or enabled == "never":
        return False

    out = sys.stdout if stream is None else stream
    isatty = getattr(out, "isatty", None)
    return bool(isatty and isatty())


def colorize(text: str, color: str, use_color: bool) -> str:
    if not use_color or color in ("none", "default"):
        return text

    code = COLOR_CODES.get(color)
    if not code:
        return text

    return f"\033[{code}m{text}{RESET}"


def format_chat_message(
    payload: dict[str, Any],
    config: dict[str, Any] | None = None,
    stream: TextIO | None = None,
    environ: dict[str, str] | None = None,
) -> str:
    cfg = config or load_chat_color_config()
    chat = cfg.get("chat") if isinstance(cfg.get("chat"), dict) else {}
    use_color = should_use_color(cfg.get("enabled", "auto"), stream=stream, environ=environ)

    prefix = colorize("[CHAT]", str(chat.get("prefix", "yellow")), use_color)
    display_id = colorize(f"[{_field(payload, 'displayId', 'id')}]", str(chat.get("id", "green")), use_color)
    nick = colorize(_field(payload, "nick", default=""), str(chat.get("nick", "green")), use_color)
    message = colorize(_field(payload, "message", default=""), str(chat.get("message", "default")), use_color)

    return f"{prefix} {display_id} {nick}: {message}"


def _field(payload: dict[str, Any], *names: str, default: str = "unknown") -> str:
    for name in names:
        value = payload.get(name)
        if value is not None:
            return str(value)

    return default


def _deep_copy_default() -> dict[str, Any]:
    return {
        "enabled": DEFAULT_CHAT_COLOR_CONFIG["enabled"],
        "chat": dict(DEFAULT_CHAT_COLOR_CONFIG["chat"]),
    }
