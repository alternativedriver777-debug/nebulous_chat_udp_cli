from __future__ import annotations

import json
from dataclasses import dataclass
from enum import Enum
from typing import Any

from .console import print_help, print_info, print_ok, print_warn


class CommandResult(Enum):
    HANDLED = "handled"
    EXIT = "exit"
    MESSAGE = "message"


@dataclass
class CommandContext:
    rpc: Any
    reset_local_rate_limit: Any


def pretty_status(st: dict[str, Any]) -> str:
    return json.dumps(st, ensure_ascii=False, indent=2)


def get_status_safe(rpc: Any) -> dict[str, Any]:
    try:
        return dict(rpc.status())
    except Exception as exc:
        raise RuntimeError(f"Failed to get status(): {exc}") from exc


def handle_command(text: str, ctx: CommandContext) -> CommandResult:
    if text in ("/exit", "/quit"):
        return CommandResult.EXIT

    if text == "/help":
        print_help()
        return CommandResult.HANDLED

    if text == "/status":
        try:
            st = get_status_safe(ctx.rpc)
            print(pretty_status(st))
        except Exception as exc:
            from .console import print_error

            print_error(str(exc))
        return CommandResult.HANDLED

    if text.startswith("/max"):
        parts = text.split(maxsplit=1)
        if len(parts) != 2:
            print_warn("Usage: /max 128")
            return CommandResult.HANDLED

        try:
            result = ctx.rpc.setmaxlen(int(parts[1]))
            print_ok(f"maxLenBytes={result.get('maxLenBytes')}")
        except Exception as exc:
            from .console import print_error

            print_error(f"setmaxlen failed: {exc}")
        return CommandResult.HANDLED

    if text.startswith("/rate"):
        parts = text.split(maxsplit=1)
        if len(parts) != 2:
            print_warn("Usage: /rate 1000")
            return CommandResult.HANDLED

        try:
            result = ctx.rpc.setratems(int(parts[1]))
            print_ok(f"rateLimitMs={result.get('rateLimitMs')}")
        except Exception as exc:
            from .console import print_error

            print_error(f"setratems failed: {exc}")
        return CommandResult.HANDLED

    if text == "/clear":
        try:
            ctx.rpc.clear()
            ctx.reset_local_rate_limit()
            print_ok("Template cleared.")
            print_info("Send any message manually in the in-game chat to capture a new template.")
        except Exception as exc:
            from .console import print_error

            print_error(f"clear failed: {exc}")
        return CommandResult.HANDLED

    if text.startswith("/recv"):
        parts = text.split(maxsplit=1)

        if len(parts) != 2 or parts[1] not in ("on", "off"):
            print_warn("Usage: /recv on or /recv off")
            return CommandResult.HANDLED

        enabled = parts[1] == "on"

        try:
            result = ctx.rpc.setrecv(enabled)
            print_ok(f"recvEnabled={result.get('recvEnabled')}")
        except Exception as exc:
            from .console import print_error

            print_error(f"setrecv failed: {exc}")

        return CommandResult.HANDLED

    if text == "/clearrecv":
        try:
            ctx.rpc.clearrecv()
            print_ok("Incoming chat state cleared.")
        except Exception as exc:
            from .console import print_error

            print_error(f"clearrecv failed: {exc}")

        return CommandResult.HANDLED

    if text.startswith("/"):
        print_warn("Unknown command. Type /help.")
        return CommandResult.HANDLED

    return CommandResult.MESSAGE
