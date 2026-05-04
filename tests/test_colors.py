from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from nebulous_chat_cli.colors import RESET, format_chat_message, load_chat_color_config


class FakeStream:
    def __init__(self, tty: bool) -> None:
        self.tty = tty

    def isatty(self) -> bool:
        return self.tty


class ColorFormattingTests(unittest.TestCase):
    def test_default_chat_format_colors_prefix_id_and_nick(self) -> None:
        line = format_chat_message(
            {
                "displayId": "123456",
                "nick": "Rush",
                "message": "hello",
            },
            stream=FakeStream(True),
            environ={},
        )

        self.assertIn("\033[33m[CHAT]" + RESET, line)
        self.assertIn("\033[32m[123456]" + RESET, line)
        self.assertIn("\033[32mRush" + RESET, line)
        self.assertTrue(line.endswith(": hello"))
        self.assertNotIn("\033[39mhello" + RESET, line)

    def test_auto_mode_disables_color_for_no_color_or_non_tty(self) -> None:
        payload = {
            "displayId": "123456",
            "nick": "Rush",
            "message": "hello",
        }

        no_color_line = format_chat_message(payload, stream=FakeStream(True), environ={"NO_COLOR": "1"})
        non_tty_line = format_chat_message(payload, stream=FakeStream(False), environ={})

        self.assertEqual(no_color_line, "[CHAT] [123456] Rush: hello")
        self.assertEqual(non_tty_line, "[CHAT] [123456] Rush: hello")

    def test_custom_config_applies_colors_per_chat_part(self) -> None:
        config = {
            "enabled": "always",
            "chat": {
                "prefix": "cyan",
                "id": "bright_yellow",
                "nick": "magenta",
                "message": "red",
            },
        }

        line = format_chat_message(
            {
                "displayId": "123456",
                "nick": "Rush",
                "message": "hello",
            },
            config=config,
            stream=FakeStream(False),
            environ={},
        )

        self.assertIn("\033[36m[CHAT]" + RESET, line)
        self.assertIn("\033[93m[123456]" + RESET, line)
        self.assertIn("\033[35mRush" + RESET, line)
        self.assertIn("\033[31mhello" + RESET, line)

    def test_load_chat_color_config_merges_known_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "chat_colors.json"
            path.write_text(
                json.dumps({
                    "enabled": "always",
                    "chat": {
                        "prefix": "cyan",
                        "id": "invalid",
                        "nick": "none",
                    },
                }),
                encoding="utf-8",
            )

            config = load_chat_color_config(path)

        self.assertEqual(config["enabled"], "always")
        self.assertEqual(config["chat"]["prefix"], "cyan")
        self.assertEqual(config["chat"]["id"], "green")
        self.assertEqual(config["chat"]["nick"], "none")
        self.assertEqual(config["chat"]["message"], "default")


if __name__ == "__main__":
    unittest.main()
