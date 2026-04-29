from __future__ import annotations

from .app import ChatCliApp
from .options import parse_args


def main(argv: list[str] | None = None) -> int:
    return ChatCliApp(parse_args(argv)).run()
