from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from nebulous_chat_cli.app import ChatCliApp
from nebulous_chat_cli.chat_log import ChatLogger


class FakeRpc:
    def __init__(self, status: dict[str, object]) -> None:
        self._status = status
        self.sent: list[str] = []

    def status(self) -> dict[str, object]:
        return self._status

    def sendchat(self, text: str) -> dict[str, object]:
        self.sent.append(text)
        return {
            "ok": True,
            "result": len(text),
            "via": "send",
            "bytes": len(text.encode("utf-8")),
            "packetLen": len(text),
        }


class ChatCliAppTests(unittest.TestCase):
    def make_app(self) -> ChatCliApp:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        return ChatCliApp(chat_logger=ChatLogger(log_dir=Path(self.tmp.name)))

    def test_send_chat_text_rejects_message_over_status_max_len(self) -> None:
        rpc = FakeRpc({
            "templateCaptured": True,
            "maxLenBytes": 2,
            "rateLimitMs": 0,
        })
        app = self.make_app()

        with redirect_stdout(io.StringIO()) as out:
            app.send_chat_text(rpc, "hello")

        self.assertEqual(rpc.sent, [])
        self.assertIn("maxLenBytes=2", out.getvalue())

    def test_send_chat_text_sends_when_status_allows(self) -> None:
        rpc = FakeRpc({
            "templateCaptured": True,
            "maxLenBytes": 128,
            "rateLimitMs": 0,
            "nick": "Me",
        })
        app = self.make_app()

        with redirect_stdout(io.StringIO()):
            app.send_chat_text(rpc, "hello")

        self.assertEqual(rpc.sent, ["hello"])
        self.assertIn("SEND [self] Me: hello", app.chat_logger.path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
