from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from nebulous_chat_cli.chat_log import ChatLogger
from nebulous_chat_cli.frida_client import find_device_by_id, get_rpc, on_message, select_device, set_chat_logger


class ScriptWithSyncExports:
    exports_sync = object()
    exports = object()


class ScriptWithLegacyExports:
    exports = object()


class FakeDevice:
    def __init__(self, device_id: str) -> None:
        self.id = device_id


class FakeManager:
    def __init__(self, devices: list[FakeDevice]) -> None:
        self.devices = devices

    def enumerate_devices(self) -> list[FakeDevice]:
        return self.devices


class FridaClientTests(unittest.TestCase):
    def tearDown(self) -> None:
        set_chat_logger(None)

    def test_get_rpc_prefers_exports_sync(self) -> None:
        script = ScriptWithSyncExports()

        self.assertIs(get_rpc(script), script.exports_sync)

    def test_get_rpc_falls_back_to_exports(self) -> None:
        script = ScriptWithLegacyExports()

        self.assertIs(get_rpc(script), script.exports)

    def test_find_device_by_id_returns_matching_tcp_device(self) -> None:
        expected = FakeDevice("127.0.0.1:5555")
        manager = FakeManager([FakeDevice("usb"), expected])

        self.assertIs(
            find_device_by_id(
                "127.0.0.1:5555",
                timeout=0,
                manager=manager,
                sleep=lambda _: None,
            ),
            expected,
        )

    def test_find_device_by_id_reports_available_devices(self) -> None:
        manager = FakeManager([FakeDevice("usb")])

        with self.assertRaisesRegex(RuntimeError, "available devices: usb"):
            find_device_by_id(
                "127.0.0.1:5555",
                timeout=0,
                manager=manager,
                sleep=lambda _: None,
            )

    def test_select_device_without_id_uses_usb_flow(self) -> None:
        expected = object()

        with patch("nebulous_chat_cli.frida_client.frida.get_usb_device", return_value=expected) as get_usb:
            self.assertIs(select_device(timeout=3), expected)

        get_usb.assert_called_once_with(timeout=3)

    def test_on_message_formats_structured_chat_message(self) -> None:
        out = io.StringIO()
        message = {
            "type": "send",
            "payload": {
                "type": "chat_message",
                "payload": {
                    "displayId": "123456",
                    "nick": "Rush",
                    "message": "hello",
                },
                "line": "[CHAT] [123456] Rush: hello",
            },
        }

        with redirect_stdout(out):
            on_message(message, None)

        self.assertEqual(out.getvalue(), "[CHAT] [123456] Rush: hello\n")

    def test_on_message_logs_structured_chat_message(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            logger = ChatLogger(log_dir=Path(tmp))
            set_chat_logger(logger)
            out = io.StringIO()
            message = {
                "type": "send",
                "payload": {
                    "type": "chat_message",
                    "payload": {
                        "displayId": "123456",
                        "nick": "Rush",
                        "message": "hello",
                    },
                },
            }

            with redirect_stdout(out):
                on_message(message, None)

            logged = logger.path.read_text(encoding="utf-8")

        self.assertIn("RECV [123456] Rush: hello", logged)

    def test_on_message_keeps_legacy_line_fallback(self) -> None:
        out = io.StringIO()

        with redirect_stdout(out):
            on_message({"type": "send", "payload": {"line": "[CHAT] old line"}}, None)

        self.assertEqual(out.getvalue(), "[CHAT] old line\n")


if __name__ == "__main__":
    unittest.main()
