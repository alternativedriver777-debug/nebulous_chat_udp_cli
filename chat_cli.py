












from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any, Dict

import frida


PROCESS_NAME = "Nebulous.io"
AGENT_FILE = Path(__file__).with_name("chat_injector_agent.js")


def print_info(msg: str) -> None:
    print(f"[*] {msg}")


def print_ok(msg: str) -> None:
    print(f"[+] {msg}")


def print_warn(msg: str) -> None:
    print(f"[!] {msg}")


def print_error(msg: str) -> None:
    print(f"[ERROR] {msg}")


def on_message(message: Dict[str, Any], data: Any) -> None:
    msg_type = message.get("type")

    if msg_type == "log":
        payload = message.get("payload", "")
        level = message.get("level", "info")
        if level == "error":
            print_error(str(payload))
        else:
            print(str(payload))
        return

    if msg_type == "send":
        payload = message.get("payload")
        if isinstance(payload, dict):
            if "line" in payload:
                print(str(payload["line"]))
            else:
                print("[agent]", json.dumps(payload, ensure_ascii=False))
        else:
            print("[agent]", payload)
        return

    if msg_type == "error":
        print_error(message.get("description", "Frida script error"))
        stack = message.get("stack")
        if stack:
            print(stack)
        return

    print("[frida]", message)


def load_agent_source() -> str:
    if not AGENT_FILE.exists():
        raise FileNotFoundError(f"Agent file not found: {AGENT_FILE}")

    return AGENT_FILE.read_text(encoding="utf-8")


def pretty_status(st: Dict[str, Any]) -> str:
    return json.dumps(st, ensure_ascii=False, indent=2)


def print_help() -> None:
    print(
        """
Commands:
  /status        показать состояние template/fd/nick/rate/max
  /max 128       установить maxLenBytes
  /rate 1000     установить rate-limit в миллисекундах
  /clear         сбросить пойманный template
  /help          показать помощь
  /exit          выйти
  /quit          выйти

Обычный текст без "/" отправляется в чат через Frida RPC.

Порядок:
  1) Зайди в комнату Nebulous.io.
  2) Запусти python chat_cli.py.
  3) Отправь любое сообщение вручную в игровом чате.
  4) Дождись лога [CHAT TEMPLATE].
  5) Пиши сообщения в эту CLI-консоль.
""".strip()
    )


def get_rpc(script: frida.core.Script) -> Any:


    rpc = getattr(script, "exports_sync", None)
    if rpc is not None:
        return rpc

    return script.exports


def get_status_safe(rpc: Any) -> Dict[str, Any]:
    try:
        return dict(rpc.status())
    except Exception as exc:
        raise RuntimeError(f"Не удалось получить status(): {exc}") from exc


def main() -> int:
    print_info("Nebulous.io chat injector controller")
    print_info(f"Agent: {AGENT_FILE}")

    try:
        agent_source = load_agent_source()
    except Exception as exc:
        print_error(str(exc))
        return 1

    device = None
    session = None
    script = None

    try:
        print_info("Подключаюсь к USB/device через Frida...")
        device = frida.get_usb_device(timeout=8)

        print_info(f"Attach к процессу: {PROCESS_NAME}")
        session = device.attach(PROCESS_NAME)

        script = session.create_script(agent_source)
        script.on("message", on_message)
        script.load()

        rpc = get_rpc(script)

        print_ok("Agent loaded.")
        print_info("Сначала отправь любое сообщение в игровом чате, чтобы поймать template.")
        print_help()

        last_local_send_at = 0.0

        while True:
            try:
                line = input("> ")
            except EOFError:
                print()
                break
            except KeyboardInterrupt:
                print()
                print_info("Ctrl+C получен, выхожу.")
                break

            if line is None:
                continue

            text = line.strip()

            if not text:
                continue

            if text in ("/exit", "/quit"):
                break

            if text == "/help":
                print_help()
                continue

            if text == "/status":
                try:
                    st = get_status_safe(rpc)
                    print(pretty_status(st))
                except Exception as exc:
                    print_error(str(exc))
                continue

            if text.startswith("/max"):
                parts = text.split(maxsplit=1)
                if len(parts) != 2:
                    print_warn("Формат: /max 128")
                    continue

                try:
                    result = rpc.setmaxlen(int(parts[1]))
                    print_ok(f"maxLenBytes={result.get('maxLenBytes')}")
                except Exception as exc:
                    print_error(f"setmaxlen failed: {exc}")
                continue

            if text.startswith("/rate"):
                parts = text.split(maxsplit=1)
                if len(parts) != 2:
                    print_warn("Формат: /rate 1000")
                    continue

                try:
                    result = rpc.setratems(int(parts[1]))
                    print_ok(f"rateLimitMs={result.get('rateLimitMs')}")
                except Exception as exc:
                    print_error(f"setratems failed: {exc}")
                continue

            if text == "/clear":
                try:
                    rpc.clear()
                    last_local_send_at = 0.0
                    print_ok("Template cleared.")
                    print_info("Отправь любое сообщение вручную в игровом чате, чтобы поймать новый template.")
                except Exception as exc:
                    print_error(f"clear failed: {exc}")
                continue

            if text.startswith("/"):
                print_warn("Неизвестная команда. Напиши /help.")
                continue


            try:
                st = get_status_safe(rpc)
            except Exception as exc:
                print_error(str(exc))
                continue

            if not st.get("templateCaptured"):
                print_warn("Сначала отправь любое сообщение в игровом чате, чтобы поймать template.")
                continue

            try:
                byte_len = len(text.encode("utf-8"))
            except UnicodeEncodeError as exc:
                print_error(f"Не удалось закодировать текст в UTF-8: {exc}")
                continue

            max_len = int(st.get("maxLenBytes") or 0)
            if max_len > 0 and byte_len > max_len:
                print_warn(f"Сообщение слишком длинное: {byte_len} байт, maxLenBytes={max_len}")
                continue

            rate_ms = int(st.get("rateLimitMs") or 0)
            now = time.monotonic() * 1000.0

            if rate_ms > 0 and last_local_send_at > 0:
                elapsed = now - last_local_send_at
                if elapsed < rate_ms:
                    wait_ms = int(rate_ms - elapsed)
                    print_warn(f"Rate-limit: подожди ещё примерно {wait_ms} ms.")
                    continue

            try:
                result = rpc.sendchat(text)
                last_local_send_at = time.monotonic() * 1000.0

                ok = bool(result.get("ok"))
                via = result.get("via")
                r = result.get("result")
                packet_len = result.get("packetLen")
                msg_bytes = result.get("bytes")

                if ok:
                    print_ok(
                        f"sent: bytes={msg_bytes} packetLen={packet_len} via={via} r={r}"
                    )
                else:
                    print_warn(
                        f"send returned unexpected result: bytes={msg_bytes} "
                        f"packetLen={packet_len} via={via} r={r}"
                    )

            except Exception as exc:
                print_error(f"sendchat failed: {exc}")

    except frida.ProcessNotFoundError:
        print_error(
            f"Процесс {PROCESS_NAME!r} не найден. "
            "Запусти игру и зайди хотя бы до момента, где процесс уже активен."
        )
        return 1

    except frida.TransportError as exc:
        print_error(f"Frida transport error: {exc}")
        print_warn("Проверь, что frida-server запущен внутри Nox и виден через adb.")
        return 1

    except KeyboardInterrupt:
        print()
        print_info("Ctrl+C получен, выхожу.")
        return 0

    except Exception as exc:
        print_error(str(exc))
        return 1

    finally:
        if script is not None:
            try:
                script.unload()
            except Exception:
                pass

        if session is not None:
            try:
                session.detach()
            except Exception:
                pass

    print_info("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())