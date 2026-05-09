from __future__ import annotations


HELP_TEXT = """
Commands:
  /status        show template/fd/nick/rate/max/recv state
  /max 128       set maxLenBytes
  /rate 1000     set the rate limit in milliseconds
  /send game      set default outgoing chat: game, clan, or private
  /game hello     send one message to public chat
  /clan hello     send one message to clan chat
  /pm 123 hello   send one private message to account/player id 123
  /show all       show incoming: all, off, game, clan, or private
  /recv on       enable incoming chat output
  /recv off      disable incoming chat output
  /log status    show chat log state and current file
  /log on        enable chat logging
  /log off       disable chat logging
  /log list      show recent chat log files
  /log show      print the last 200 lines from the current log
  /log show 1    print the last 200 lines from log #1 in /log list
  /clearrecv     reset incoming message state
  /clear         clear the captured template
  /help          show help
  /exit          exit
  /quit          exit

Plain text without "/" is sent to the default outgoing chat through Frida RPC.
Incoming messages are printed automatically when recvEnabled=true.

Flow:
  1) Join a Nebulous.io room.
  2) Run python chat_cli.py.
  3) Send any message manually in the in-game chat.
  4) Wait for the [CHAT TEMPLATE] log.
  5) Type messages into this CLI console.

For clan/private sending, manually send one message from that in-game chat first
so the agent can capture its packet template.
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
