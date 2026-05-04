from __future__ import annotations

import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from nebulous_chat_cli.chat_log import ChatLogger


class ChatLoggerTests(unittest.TestCase):
    def test_log_incoming_and_outgoing_messages(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            logger = ChatLogger(
                log_dir=Path(tmp),
                started_at=datetime(2026, 5, 4, 22, 10, 30),
            )

            logger.log_incoming({
                "displayId": "123456",
                "nick": "Rush",
                "message": "hello",
                "publicIdHex": "0x01020304",
                "source": "recv",
            })
            logger.log_outgoing("hi there", nick="Me", result={"via": "send", "bytes": 8})

            lines = logger.read_log(lines=0)

        self.assertEqual(logger.path.name, "chat_2026-05-04_22-10-30.log")
        self.assertEqual(len(lines), 2)
        self.assertIn("RECV [123456] Rush: hello", lines[0])
        self.assertNotIn("publicId=0x01020304", lines[0])
        self.assertNotIn("source=recv", lines[0])
        self.assertIn("SEND [self] Me: hi there", lines[1])
        self.assertIn("via=send", lines[1])

    def test_disabled_logger_does_not_create_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            logger = ChatLogger(log_dir=Path(tmp), enabled=False)

            logger.log_outgoing("hidden", nick="Me")

            self.assertFalse(logger.path.exists())
            self.assertEqual(logger.records_written, 0)

    def test_list_and_index_log_selection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_dir = Path(tmp)
            older = log_dir / "chat_2026-05-04_10-00-00.log"
            newer = log_dir / "chat_2026-05-04_11-00-00.log"
            older.write_text("older\n", encoding="utf-8")
            newer.write_text("newer\n", encoding="utf-8")

            logger = ChatLogger(log_dir=log_dir)
            logs = logger.list_logs()
            selected = logger.resolve_log("1")

        self.assertEqual(logs[0].name, newer.name)
        self.assertEqual(selected.name, newer.name)


if __name__ == "__main__":
    unittest.main()
