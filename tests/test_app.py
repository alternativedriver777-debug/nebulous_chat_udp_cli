from __future__ import annotations

import io
import unittest
from contextlib import redirect_stdout

from nebulous_chat_cli.app import ChatCliApp


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
    def test_send_chat_text_rejects_message_over_status_max_len(self) -> None:
        rpc = FakeRpc({
            "templateCaptured": True,
            "maxLenBytes": 2,
            "rateLimitMs": 0,
        })
        app = ChatCliApp()

        with redirect_stdout(io.StringIO()) as out:
            app.send_chat_text(rpc, "hello")

        self.assertEqual(rpc.sent, [])
        self.assertIn("maxLenBytes=2", out.getvalue())

    def test_send_chat_text_sends_when_status_allows(self) -> None:
        rpc = FakeRpc({
            "templateCaptured": True,
            "maxLenBytes": 128,
            "rateLimitMs": 0,
        })
        app = ChatCliApp()

        with redirect_stdout(io.StringIO()):
            app.send_chat_text(rpc, "hello")

        self.assertEqual(rpc.sent, ["hello"])


if __name__ == "__main__":
    unittest.main()
