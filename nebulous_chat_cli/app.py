from __future__ import annotations

import time

import frida

from .adb import AdbError, bootstrap_adb_target
from .commands import CommandContext, CommandResult, get_status_safe, handle_command
from .config import AGENT_FILE, DEFAULT_ADB_TIMEOUT, DEFAULT_FRIDA_SERVER_PATH, DEFAULT_FRIDA_TIMEOUT, PROCESS_NAME
from .console import print_error, print_help, print_info, print_ok, print_warn
from .frida_client import connect, load_agent_source
from .options import CliOptions


class ChatCliApp:
    def __init__(self, options: CliOptions | None = None) -> None:
        self.options = options or CliOptions(
            adb=None,
            frida_server_path=DEFAULT_FRIDA_SERVER_PATH,
            adb_timeout=DEFAULT_ADB_TIMEOUT,
        )
        self.last_local_send_at = 0.0

    def reset_local_rate_limit(self) -> None:
        self.last_local_send_at = 0.0

    def run(self) -> int:
        print_info("Nebulous.io chat injector controller")
        print_info(f"Agent: {AGENT_FILE}")

        try:
            agent_source = load_agent_source(AGENT_FILE)
        except Exception as exc:
            print_error(str(exc))
            return 1

        connection = None

        try:
            device_id = None
            frida_timeout = DEFAULT_FRIDA_TIMEOUT

            if self.options.adb:
                device_id = self.options.adb
                frida_timeout = self.options.adb_timeout
                print_info(f"ADB connect: {device_id}")
                bootstrap = bootstrap_adb_target(
                    serial=device_id,
                    frida_server_path=self.options.frida_server_path,
                    timeout=self.options.adb_timeout,
                )
                if bootstrap.frida_server_started:
                    print_ok("frida-server started.")
                else:
                    print_info("frida-server already running.")
                print_info(f"Connecting to Frida device: {device_id}")
            else:
                print_info("Connecting to USB/device through Frida...")

            print_info(f"Attaching to process: {PROCESS_NAME}")
            connection = connect(
                PROCESS_NAME,
                agent_source,
                timeout=frida_timeout,
                device_id=device_id,
            )
            rpc = connection.rpc

            print_ok("Agent loaded.")
            print_info("Send any message in the in-game chat first to capture the template.")
            print_help()

            ctx = CommandContext(
                rpc=rpc,
                reset_local_rate_limit=self.reset_local_rate_limit,
            )

            while True:
                try:
                    line = input("> ")
                except EOFError:
                    print()
                    break
                except KeyboardInterrupt:
                    print()
                    print_info("Ctrl+C received, exiting.")
                    break

                if line is None:
                    continue

                text = line.strip()
                if not text:
                    continue

                command_result = handle_command(text, ctx)
                if command_result == CommandResult.EXIT:
                    break
                if command_result == CommandResult.HANDLED:
                    continue

                self.send_chat_text(rpc, text)

        except frida.ProcessNotFoundError:
            print_error(
                f"Process {PROCESS_NAME!r} was not found. "
                "Start the game and enter far enough for the process to be active."
            )
            return 1

        except AdbError as exc:
            print_error(str(exc))
            return 1

        except frida.TransportError as exc:
            print_error(f"Frida transport error: {exc}")
            print_warn("Check that frida-server is running inside the Android target and the target is visible through adb.")
            return 1

        except KeyboardInterrupt:
            print()
            print_info("Ctrl+C received, exiting.")
            return 0

        except Exception as exc:
            print_error(str(exc))
            return 1

        finally:
            if connection is not None:
                connection.close()

        print_info("Done.")
        return 0

    def send_chat_text(self, rpc: object, text: str) -> None:
        try:
            st = get_status_safe(rpc)
        except Exception as exc:
            print_error(str(exc))
            return

        if not st.get("templateCaptured"):
            print_warn("Send any message in the in-game chat first to capture the template.")
            return

        try:
            byte_len = len(text.encode("utf-8"))
        except UnicodeEncodeError as exc:
            print_error(f"Failed to encode text as UTF-8: {exc}")
            return

        max_len = int(st.get("maxLenBytes") or 0)
        if max_len > 0 and byte_len > max_len:
            print_warn(f"Message is too long: {byte_len} bytes, maxLenBytes={max_len}")
            return

        rate_ms = int(st.get("rateLimitMs") or 0)
        now = time.monotonic() * 1000.0

        if rate_ms > 0 and self.last_local_send_at > 0:
            elapsed = now - self.last_local_send_at
            if elapsed < rate_ms:
                wait_ms = int(rate_ms - elapsed)
                print_warn(f"Rate limit: wait about {wait_ms} ms more.")
                return

        try:
            result = rpc.sendchat(text)  # type: ignore[attr-defined]
            self.last_local_send_at = time.monotonic() * 1000.0

            ok = bool(result.get("ok"))
            via = result.get("via")
            r = result.get("result")
            packet_len = result.get("packetLen")
            msg_bytes = result.get("bytes")

            if ok:
                print_ok(f"sent: bytes={msg_bytes} packetLen={packet_len} via={via} r={r}")
            else:
                print_warn(
                    f"send returned unexpected result: bytes={msg_bytes} "
                    f"packetLen={packet_len} via={via} r={r}"
                )

        except Exception as exc:
            print_error(f"sendchat failed: {exc}")
