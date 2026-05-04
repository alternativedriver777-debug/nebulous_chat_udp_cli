from __future__ import annotations

import io
import unittest
from contextlib import redirect_stderr

from nebulous_chat_cli.options import parse_args


class OptionsTests(unittest.TestCase):
    def test_parse_args_keeps_usb_defaults(self) -> None:
        options = parse_args([])

        self.assertIsNone(options.adb)
        self.assertEqual(options.frida_server_path, "/data/local/tmp/frida-server")
        self.assertEqual(options.adb_timeout, 10.0)
        self.assertTrue(options.chat_log_enabled)

    def test_parse_args_accepts_adb_target_and_server_path(self) -> None:
        options = parse_args([
            "--adb",
            "127.0.0.1:5555",
            "--frida-server-path",
            "/tmp/frida-server",
            "--adb-timeout",
            "3",
        ])

        self.assertEqual(options.adb, "127.0.0.1:5555")
        self.assertEqual(options.frida_server_path, "/tmp/frida-server")
        self.assertEqual(options.adb_timeout, 3.0)

    def test_parse_args_can_disable_chat_log(self) -> None:
        options = parse_args(["--no-log"])

        self.assertFalse(options.chat_log_enabled)

    def test_parse_args_rejects_non_positive_timeout(self) -> None:
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                parse_args(["--adb-timeout", "0"])


if __name__ == "__main__":
    unittest.main()
