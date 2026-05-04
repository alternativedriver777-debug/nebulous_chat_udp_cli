from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from nebulous_chat_cli.chat_log import ChatLogger
from nebulous_chat_cli.commands import (
    CommandContext,
    CommandResult,
    get_status_safe,
    handle_command,
)


class FakeRpc:
    def __init__(self) -> None:
        self.max_len = None
        self.rate_ms = None
        self.cleared = False
        self.recv_enabled = None
        self.recv_cleared = False

    def status(self) -> dict[str, object]:
        return {
            "templateCaptured": True,
            "maxLenBytes": 128,
            "rateLimitMs": 1000,
        }

    def setmaxlen(self, value: int) -> dict[str, object]:
        self.max_len = value
        return {"ok": True, "maxLenBytes": value}

    def setratems(self, value: int) -> dict[str, object]:
        self.rate_ms = value
        return {"ok": True, "rateLimitMs": value}

    def clear(self) -> dict[str, object]:
        self.cleared = True
        return {"ok": True}

    def setrecv(self, enabled: bool) -> dict[str, object]:
        self.recv_enabled = enabled
        return {"ok": True, "recvEnabled": enabled}

    def clearrecv(self) -> dict[str, object]:
        self.recv_cleared = True
        return {"ok": True}


class CommandTests(unittest.TestCase):
    def make_context(
        self,
        rpc: FakeRpc | None = None,
        chat_logger: ChatLogger | None = None,
    ) -> tuple[CommandContext, list[bool]]:
        resets: list[bool] = []
        return CommandContext(
            rpc=rpc or FakeRpc(),
            reset_local_rate_limit=lambda: resets.append(True),
            chat_logger=chat_logger,
        ), resets

    def test_status_command_is_handled(self) -> None:
        ctx, _ = self.make_context()

        with redirect_stdout(io.StringIO()) as out:
            result = handle_command("/status", ctx)

        self.assertEqual(result, CommandResult.HANDLED)
        self.assertIn("templateCaptured", out.getvalue())

    def test_max_command_updates_rpc(self) -> None:
        rpc = FakeRpc()
        ctx, _ = self.make_context(rpc)

        with redirect_stdout(io.StringIO()):
            result = handle_command("/max 256", ctx)

        self.assertEqual(result, CommandResult.HANDLED)
        self.assertEqual(rpc.max_len, 256)

    def test_rate_command_updates_rpc(self) -> None:
        rpc = FakeRpc()
        ctx, _ = self.make_context(rpc)

        with redirect_stdout(io.StringIO()):
            result = handle_command("/rate 0", ctx)

        self.assertEqual(result, CommandResult.HANDLED)
        self.assertEqual(rpc.rate_ms, 0)

    def test_clear_command_resets_local_rate_limit(self) -> None:
        rpc = FakeRpc()
        ctx, resets = self.make_context(rpc)

        with redirect_stdout(io.StringIO()):
            result = handle_command("/clear", ctx)

        self.assertEqual(result, CommandResult.HANDLED)
        self.assertTrue(rpc.cleared)
        self.assertEqual(resets, [True])

    def test_recv_command_updates_rpc(self) -> None:
        rpc = FakeRpc()
        ctx, _ = self.make_context(rpc)

        with redirect_stdout(io.StringIO()):
            result = handle_command("/recv off", ctx)

        self.assertEqual(result, CommandResult.HANDLED)
        self.assertEqual(rpc.recv_enabled, False)

    def test_clearrecv_command_updates_rpc(self) -> None:
        rpc = FakeRpc()
        ctx, _ = self.make_context(rpc)

        with redirect_stdout(io.StringIO()):
            result = handle_command("/clearrecv", ctx)

        self.assertEqual(result, CommandResult.HANDLED)
        self.assertTrue(rpc.recv_cleared)

    def test_unknown_slash_command_is_handled(self) -> None:
        ctx, _ = self.make_context()

        with redirect_stdout(io.StringIO()) as out:
            result = handle_command("/wat", ctx)

        self.assertEqual(result, CommandResult.HANDLED)
        self.assertIn("[!]", out.getvalue())

    def test_plain_text_is_message(self) -> None:
        ctx, _ = self.make_context()

        self.assertEqual(handle_command("hello", ctx), CommandResult.MESSAGE)

    def test_exit_commands_exit(self) -> None:
        ctx, _ = self.make_context()

        self.assertEqual(handle_command("/exit", ctx), CommandResult.EXIT)
        self.assertEqual(handle_command("/quit", ctx), CommandResult.EXIT)

    def test_log_commands_control_and_show_logger(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            logger = ChatLogger(log_dir=Path(tmp))
            logger.log_outgoing("hello", nick="Me")
            ctx, _ = self.make_context(chat_logger=logger)

            with redirect_stdout(io.StringIO()) as out:
                self.assertEqual(handle_command("/log status", ctx), CommandResult.HANDLED)
                self.assertEqual(handle_command("/log off", ctx), CommandResult.HANDLED)
                self.assertEqual(handle_command("/log on", ctx), CommandResult.HANDLED)
                self.assertEqual(handle_command("/log list", ctx), CommandResult.HANDLED)
                self.assertEqual(handle_command("/log show 1 10", ctx), CommandResult.HANDLED)

        output = out.getvalue()
        self.assertIn("log=on", output)
        self.assertIn("Chat logging disabled", output)
        self.assertIn("chat_", output)
        self.assertIn("SEND [self] Me: hello", output)

    def test_get_status_safe_wraps_errors(self) -> None:
        class BrokenRpc:
            def status(self) -> None:
                raise RuntimeError("boom")

        with self.assertRaises(RuntimeError) as err:
            get_status_safe(BrokenRpc())

        self.assertIn("status()", str(err.exception))


if __name__ == "__main__":
    unittest.main()
