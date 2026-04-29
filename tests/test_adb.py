from __future__ import annotations

import unittest
from typing import Sequence

from nebulous_chat_cli.adb import (
    AdbCommandResult,
    AdbError,
    bootstrap_adb_target,
)


SERIAL = "127.0.0.1:5555"
SERVER_PATH = "/data/local/tmp/frida-server"


class FakeRunner:
    def __init__(self, responses: list[AdbCommandResult]) -> None:
        self.responses = responses
        self.commands: list[tuple[str, ...]] = []

    def __call__(self, command: Sequence[str], timeout: float) -> AdbCommandResult:
        self.commands.append(tuple(command))
        if not self.responses:
            raise AssertionError(f"unexpected command: {command}")
        return self.responses.pop(0)


class AdbBootstrapTests(unittest.TestCase):
    def test_connects_and_skips_start_when_frida_server_is_running(self) -> None:
        runner = FakeRunner([
            AdbCommandResult(0, stdout="Android Debug Bridge version 1.0.41"),
            AdbCommandResult(0, stdout=f"already connected to {SERIAL}"),
            AdbCommandResult(0),
            AdbCommandResult(0, stdout="1234"),
        ])

        result = bootstrap_adb_target(SERIAL, SERVER_PATH, timeout=10, runner=runner)

        self.assertFalse(result.frida_server_started)
        self.assertNotIn(
            ("adb", "-s", SERIAL, "shell", "su", "-c", f"nohup {SERVER_PATH} >/dev/null 2>&1 &"),
            runner.commands,
        )

    def test_connects_and_starts_existing_frida_server(self) -> None:
        runner = FakeRunner([
            AdbCommandResult(0, stdout="Android Debug Bridge version 1.0.41"),
            AdbCommandResult(0, stdout=f"connected to {SERIAL}"),
            AdbCommandResult(0),
            AdbCommandResult(1),
            AdbCommandResult(0),
            AdbCommandResult(0),
            AdbCommandResult(0, stdout="1234"),
        ])

        result = bootstrap_adb_target(SERIAL, SERVER_PATH, timeout=10, runner=runner)

        self.assertTrue(result.frida_server_started)
        self.assertEqual(runner.commands[1], ("adb", "connect", SERIAL))
        self.assertEqual(runner.commands[2], ("adb", "-s", SERIAL, "wait-for-device"))
        self.assertIn(
            ("adb", "-s", SERIAL, "shell", "su", "-c", "pidof frida-server"),
            runner.commands,
        )
        self.assertIn(
            ("adb", "-s", SERIAL, "shell", "su", "-c", f"nohup {SERVER_PATH} >/dev/null 2>&1 &"),
            runner.commands,
        )

    def test_connect_failure_is_readable(self) -> None:
        runner = FakeRunner([
            AdbCommandResult(0, stdout="Android Debug Bridge version 1.0.41"),
            AdbCommandResult(0, stdout=f"failed to connect to {SERIAL}"),
        ])

        with self.assertRaisesRegex(AdbError, "adb connect"):
            bootstrap_adb_target(SERIAL, SERVER_PATH, timeout=10, runner=runner)

    def test_missing_remote_frida_server_is_readable(self) -> None:
        runner = FakeRunner([
            AdbCommandResult(0, stdout="Android Debug Bridge version 1.0.41"),
            AdbCommandResult(0, stdout=f"connected to {SERIAL}"),
            AdbCommandResult(0),
            AdbCommandResult(1),
            AdbCommandResult(1),
        ])

        with self.assertRaisesRegex(AdbError, "frida-server was not found"):
            bootstrap_adb_target(SERIAL, SERVER_PATH, timeout=10, runner=runner)

    def test_su_denied_is_readable(self) -> None:
        runner = FakeRunner([
            AdbCommandResult(0, stdout="Android Debug Bridge version 1.0.41"),
            AdbCommandResult(0, stdout=f"connected to {SERIAL}"),
            AdbCommandResult(0),
            AdbCommandResult(1),
            AdbCommandResult(1, stderr="su: inaccessible or not found"),
        ])

        with self.assertRaisesRegex(AdbError, "`su -c` failed"):
            bootstrap_adb_target(SERIAL, SERVER_PATH, timeout=10, runner=runner)


if __name__ == "__main__":
    unittest.main()
