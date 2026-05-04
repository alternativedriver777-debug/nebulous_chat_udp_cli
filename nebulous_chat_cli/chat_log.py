from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from .config import CHAT_LOG_DIR


@dataclass
class ChatLogger:
    log_dir: Path = CHAT_LOG_DIR
    enabled: bool = True
    started_at: datetime = field(default_factory=datetime.now)

    def __post_init__(self) -> None:
        self.path = self.log_dir / f"chat_{self.started_at.strftime('%Y-%m-%d_%H-%M-%S')}.log"
        self.records_written = 0

    def set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled

    def status(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "path": str(self.path),
            "recordsWritten": self.records_written,
            "exists": self.path.exists(),
        }

    def log_incoming(self, payload: dict[str, Any]) -> None:
        self.write_chat_line(
            direction="RECV",
            nick=_value(payload, "nick", default=""),
            message=_value(payload, "message", default=""),
            display_id=_value(payload, "displayId", "id", default="unknown"),
        )

    def log_outgoing(
        self,
        text: str,
        nick: str | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        result = result or {}
        self.write_chat_line(
            direction="SEND",
            nick=nick or "me",
            message=text,
            display_id="self",
            metadata={
                "via": result.get("via"),
                "bytes": result.get("bytes"),
                "packetLen": result.get("packetLen"),
            },
        )

    def write_chat_line(
        self,
        direction: str,
        nick: str,
        message: str,
        display_id: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        if not self.enabled:
            return

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"[{timestamp}] {direction} [{_one_line(display_id)}] {_one_line(nick)}: {_one_line(message)}"
        meta = _format_metadata(metadata or {})

        if meta:
            line = f"{line} {{{meta}}}"

        self.log_dir.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")

        self.records_written += 1

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


def _value(payload: dict[str, Any], *names: str, default: str) -> str:
    for name in names:
        value = payload.get(name)
        if value is not None:
            return str(value)

    return default


def _one_line(value: str) -> str:
    return str(value).replace("\r", "\\r").replace("\n", "\\n")


def _format_metadata(metadata: dict[str, Any]) -> str:
    parts = []

    for key, value in metadata.items():
        if value is not None:
            parts.append(f"{key}={_one_line(str(value))}")

    return " ".join(parts)
