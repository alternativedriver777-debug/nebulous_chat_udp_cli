from __future__ import annotations


HELP_TEXT = """
Commands:
  /status        показать состояние template/fd/nick/rate/max/recv
  /max 128       установить maxLenBytes
  /rate 1000     установить rate-limit в миллисекундах
  /recv on       включить отображение входящего чата
  /recv off      выключить отображение входящего чата
  /clearrecv     сбросить счётчик входящих сообщений
  /clear         сбросить пойманный template
  /help          показать помощь
  /exit          выйти
  /quit          выйти

Обычный текст без "/" отправляется в чат через Frida RPC.
Входящие сообщения печатаются автоматически, если recvEnabled=true.

Порядок:
  1) Зайди в комнату Nebulous.io.
  2) Запусти python chat_cli.py.
  3) Отправь любое сообщение вручную в игровом чате.
  4) Дождись лога [CHAT TEMPLATE].
  5) Пиши сообщения в эту CLI-консоль.
""".strip()


def print_info(msg: str) -> None:
    print(f"[*] {msg}")


def print_ok(msg: str) -> None:
    print(f"[+] {msg}")


def print_warn(msg: str) -> None:
    print(f"[!] {msg}")


def print_error(msg: str) -> None:
    print(f"[ERROR] {msg}")


def print_help() -> None:
    print(HELP_TEXT)
