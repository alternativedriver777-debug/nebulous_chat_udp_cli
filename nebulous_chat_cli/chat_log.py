from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import CHAT_LOG_DIR


CHAT_KINDS = ("game", "clan", "private")


@dataclass
class ChatLogger:
    log_dir: Path = CHAT_LOG_DIR
    enabled: bool = True
    started_at: datetime = field(default_factory=datetime.now)

    def __post_init__(self) -> None:
        stamp = self.started_at.strftime("%Y-%m-%d_%H-%M-%S")
        self.paths = {
            kind: self.log_dir / f"chat_{stamp}_{kind}.log"
            for kind in CHAT_KINDS
        }
        self.path = self.paths["game"]
        self.records_written = 0
        self.records_by_kind = {kind: 0 for kind in CHAT_KINDS}

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled

    def status(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "path": str(self.path),
            "paths": {kind: str(path) for kind, path in self.paths.items()},
            "recordsWritten": self.records_written,
            "recordsByKind": dict(self.records_by_kind),
            "exists": any(path.exists() for path in self.paths.values()),
        }

    def log_incoming(self, payload: dict[str, Any]) -> None:
        kind = normalize_chat_kind(_value(payload, "kind", default="game"))
        self.write_chat_line(
            kind=kind,
            direction="RECV",
            nick=_value(payload, "nick", default=""),
            message=_value(payload, "message", default=""),
            display_id=_value(payload, "displayId", "id", default="unknown"),
            metadata=_incoming_metadata(payload),
        )

    def log_outgoing(
        self,
        text: str,
        nick: str | None = None,
        result: dict[str, Any] | None = None,
        kind: str = "game",
    ) -> None:
        result = result or {}
        chat_kind = normalize_chat_kind(result.get("kind") or kind)
        self.write_chat_line(
            kind=chat_kind,
            direction="SEND",
            nick=nick or "me",
            message=text,
            display_id=_outgoing_display_id(result),
            metadata={
                "via": result.get("via"),
                "bytes": result.get("bytes"),
                "packetLen": result.get("packetLen"),
                "targetId": result.get("targetId"),
            },
        )

    def write_chat_line(
        self,
        direction: str,
        nick: str,
        message: str,
        display_id: str,
        metadata: dict[str, Any] | None = None,
        kind: str = "game",
    ) -> None:
        if not self.enabled:
            return

        chat_kind = normalize_chat_kind(kind)
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        label = chat_kind.upper() if chat_kind != "game" else "CHAT"
        line = (
            f"[{timestamp}] {direction} {label} "
            f"[{_one_line(display_id)}] {_one_line(nick)}: {_one_line(message)}"
        )
        meta = _format_metadata(metadata or {})

        if meta:
            line = f"{line} {{{meta}}}"

        self.log_dir.mkdir(parents=True, exist_ok=True)
        with self.paths[chat_kind].open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")

        self.records_written += 1
        self.records_by_kind[chat_kind] = self.records_by_kind.get(chat_kind, 0) + 1

    def list_logs(self, limit: int = 20) -> list[Path]:
        if not self.log_dir.exists():
            return []

        logs = sorted(
            self.log_dir.glob("chat_*.log"),
            key=lambda p: p.name,
            reverse=True,
        )
        return logs[:limit]

    def resolve_log(self, selector: str | None = None) -> Path:
        if not selector or selector == "current":
            return self.path

        kind = selector.lower()
        if kind in self.paths:
            return self.paths[kind]

        if selector.isdigit():
            index = int(selector)
            logs = self.list_logs(limit=max(index, 20))

            if 1 <= index <= len(logs):
                return logs[index - 1]

            raise ValueError(f"log index out of range: {selector}")

        candidate = Path(selector)
        if candidate.is_absolute():
            return candidate

        return self.log_dir / candidate.name

    def read_log(self, selector: str | None = None, lines: int = 200) -> list[str]:
        path = self.resolve_log(selector)

        if not path.exists():
            raise FileNotFoundError(f"Log file not found: {path}")

        content = path.read_text(encoding="utf-8").splitlines()

        if lines <= 0 or lines >= len(content):
            return content

        return content[-lines:]


def normalize_chat_kind(kind: object) -> str:
    value = str(kind or "game").lower()
    aliases = {
        "chat": "game",
        "public": "game",
        "g": "game",
        "c": "clan",
        "clan": "clan",
        "pm": "private",
        "p": "private",
        "private": "private",
    }
    return aliases.get(value, "game")


def _value(payload: dict[str, Any], *names: str, default: str) -> str:
    for name in names:
        value = payload.get(name)
        if value is not None:
            return str(value)

    return default


def _incoming_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    kind = normalize_chat_kind(payload.get("kind"))

    if kind == "private":
        return {
            "source": payload.get("source"),
            "id1": payload.get("id1"),
            "id2": payload.get("id2"),
            "targetId": payload.get("targetId"),
        }

    if kind == "clan":
        return {
            "source": payload.get("source"),
            "role": payload.get("clanRole"),
        }

    return {}


def _outgoing_display_id(result: dict[str, Any]) -> str:
    kind = normalize_chat_kind(result.get("kind"))

    if kind == "private" and result.get("targetId") is not None:
        return str(result.get("targetId"))

    return "self"


def _one_line(value: str) -> str:
    return str(value).replace("\r", "\\r").replace("\n", "\\n")


def _format_metadata(metadata: dict[str, Any]) -> str:
    parts = []

    for key, value in metadata.items():
        if value is not None:
            parts.append(f"{key}={_one_line(str(value))}")

    return " ".join(parts)
