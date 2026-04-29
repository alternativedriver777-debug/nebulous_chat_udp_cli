from __future__ import annotations

import unittest
from unittest.mock import patch

from nebulous_chat_cli.frida_client import find_device_by_id, get_rpc, select_device


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


if __name__ == "__main__":
    unittest.main()
