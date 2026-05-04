from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Sequence

from .config import DEFAULT_ADB_TIMEOUT, DEFAULT_FRIDA_SERVER_PATH


@dataclass(frozen=True)
class CliOptions:
    adb: str | None
    frida_server_path: str
    adb_timeout: float
    chat_log_enabled: bool = True


def parse_args(argv: Sequence[str] | None = None) -> CliOptions:
    parser = argparse.ArgumentParser(
        description="Nebulous.io chat injector controller",
    )
    parser.add_argument(
        "--adb",
        metavar="HOST:PORT",
        help="connect to an Android target through `adb connect HOST:PORT` first",
    )
    parser.add_argument(
        "--frida-server-path",
        default=DEFAULT_FRIDA_SERVER_PATH,
        help=f"remote frida-server path, default: {DEFAULT_FRIDA_SERVER_PATH}",
    )
    parser.add_argument(
        "--adb-timeout",
        type=positive_float,
        default=DEFAULT_ADB_TIMEOUT,
        help=f"ADB/Frida TCP wait timeout in seconds, default: {DEFAULT_ADB_TIMEOUT:g}",
    )
    parser.add_argument(
        "--no-log",
        action="store_true",
        help="disable chat message logging at startup",
    )

    args = parser.parse_args(argv)
    return CliOptions(
        adb=args.adb,
        frida_server_path=args.frida_server_path,
        adb_timeout=args.adb_timeout,
        chat_log_enabled=not args.no_log,
    )


def positive_float(value: str) -> float:
    try:
        parsed = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be a number") from exc

    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than 0")

    return parsed
