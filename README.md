# Nebulous.io UDP Chat CLI

<p align="center">
  <img src="https://github.com/user-attachments/assets/0dd68859-74e2-40b1-b492-e29604f27557" width="70%" />
</p>

A CLI tool for sending and receiving Nebulous.io chat messages through Frida.

The Frida agent first intercepts a real outgoing UDP chat packet from the game and stores it as a template. After that, the CLI can build new chat packets from the same client network context and send them through `sendto` or `send`.

The same agent also hooks `recvfrom` and `recv` so incoming chat packets can be parsed and printed in the CLI in real time.

## Requirements

- Python 3.9+.
- The Python `frida` package.
- `adb` available in `PATH`.
- An Android device or Android emulator visible through `adb`.
- `frida-server` already copied to the Android target, usually at `/data/local/tmp/frida-server`.
- Root access through `adb shell su -c ...` to start `frida-server`.
- Nebulous.io running on the target device.

The specific emulator does not matter. Any emulator or physical Android device should work as long as `adb devices` can see it, the `frida-server` version is compatible with the installed Python `frida` package, and the game process can be attached to.

## Running

Standard USB/ADB flow, when the device is already visible to Frida:

```bash
python chat_cli.py
```

TCP/ADB flow, when you need to connect to the target by `ip:port` first:

```bash
python chat_cli.py --adb 127.0.0.1:62001
```

Custom `frida-server` path on the Android target:

```bash
python chat_cli.py --adb 127.0.0.1:62001 --frida-server-path /data/local/tmp/frida-server
```

Start without chat logging:

```bash
python chat_cli.py --no-log
```

Package-style execution is also available:

```bash
python -m nebulous_chat_cli --adb 127.0.0.1:62001
```

Inside the CLI, use `/help` to list available commands.

## ADB TCP And Frida Server

When started with `--adb HOST:PORT`, the program does the following:

1. Checks that `adb` is available.
2. Runs `adb connect HOST:PORT`.
3. Runs `adb -s HOST:PORT wait-for-device`.
4. Checks `frida-server` with `adb -s HOST:PORT shell su -c "pidof frida-server"`.
5. If the server is not running, starts it through `su -c`:

```bash
adb -s HOST:PORT shell su -c "nohup /data/local/tmp/frida-server >/dev/null 2>&1 &"
```

6. Waits for a Frida device with the id `HOST:PORT`.
7. Attaches to the `Nebulous.io` process.

Important: the CLI does not download or upload `frida-server` automatically. The binary must already exist on the device or emulator. If you use Android Wireless Debugging with pairing, run `adb pair` beforehand; the CLI only automates `adb connect HOST:PORT`.

## Usage

1. Start an Android emulator or connect a device.
2. Make sure the target is visible through ADB:

```bash
adb devices
```

3. Make sure `frida-server` exists on the Android target, for example:

```bash
adb -s 127.0.0.1:62001 shell su -c "ls -l /data/local/tmp/frida-server"
```

4. Open Nebulous.io and join a room.
5. Start the CLI:

```bash
python chat_cli.py --adb 127.0.0.1:62001
```

6. In the game, manually send any message to the public chat.
7. Wait until the console prints a log like this:

```text
[CHAT TEMPLATE] source=sendto fd=... nick="..." msg="hello"
```

8. You can now type messages directly in the CLI:

```text
> test
> hello
> yoo how are you
```

Incoming chat messages are printed automatically while the CLI is running:

```text
[CHAT] [123456] Rush: hello
[CHAT] [987654] OtherPlayer: hi
```

## CLI Commands

```text
/status        show the template/fd/nick/rate/max/recv state
/max 128       set maxLenBytes
/rate 1000     set the rate limit in milliseconds
/recv on       enable incoming chat display
/recv off      disable incoming chat display
/log status    show chat log state and current file
/log on        enable chat logging
/log off       disable chat logging
/log list      show recent chat log files
/log show      print the last 200 lines from the current log
/log show 1    print the last 200 lines from log #1 in /log list
/clearrecv     clear incoming chat counters and dedupe state
/clear         clear the captured template
/help          show help
/exit          exit
/quit          exit
```

Plain text without a leading `/` is sent to the chat through Frida RPC.

Incoming chat display is enabled by default. Use `/recv off` if you only want to send messages and keep the terminal quiet.

## Chat Logs

Incoming and successfully sent chat messages are logged by default. Each CLI session writes to a timestamped file in `logs/`:

```text
logs/chat_2026-05-04_22-10-30.log
```

Log lines are plain text so they can be opened, searched, or scrolled later:

```text
[2026-05-04 22:10:31] RECV [123456] Rush: hello
[2026-05-04 22:10:35] SEND [self] MyNick: hi there {via=send bytes=8 packetLen=42}
```

Use `/log off` and `/log on` while the CLI is running, or start with `--no-log` to disable logging immediately. Use `/log list` to find logs by date/time and `/log show 1` to print a selected log back into the console.

## Chat Colors

Incoming chat output supports optional ANSI colors. By default, colors are enabled only for interactive terminals and disabled when `NO_COLOR` is set.

Create `chat_colors.json` next to `chat_cli.py` to customize chat colors:

```json
{
  "enabled": "auto",
  "chat": {
    "prefix": "yellow",
    "id": "green",
    "nick": "green",
    "message": "default"
  }
}
```

`enabled` can be `auto`, `always`, or `never`. Supported colors are `default`, `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, their `bright_*` variants, and `none`.

## Receiving Chat Messages

The agent hooks `recvfrom` and `recv` in addition to `sendto` and `send`. Because receive buffers are filled after the native function returns, incoming packets are parsed in the hook `onLeave` handler.

Incoming packets with opcode `0x89` are parsed using the same chat packet structure:

```text
u8      opcode (0x89)
u32be   public_id
MUTF8   alias
MUTF8   message
i32be   account_id / -1
...     tail
```

The `account_id` field after the message is shown as the player identifier, for example:

```text
[CHAT] [123456] Rush: hello
```

The earlier `public_id` field is still kept in the internal event payload as `publicId` / `publicIdHex` for debugging.

To avoid false positives from unrelated binary UDP packets, the receiver filters parsed candidates before printing them. Nicknames and messages must look like clean UTF-8 chat text, and obviously binary strings are ignored.

## Project Structure

- `chat_cli.py` - compatibility entrypoint for running the CLI.
- `nebulous_chat_cli/` - Python package with the CLI, commands, ADB bootstrap, and Frida lifecycle.
- `agent/src/` - modular Frida agent source files.
- `chat_injector_agent.js` - bundled agent loaded by the CLI.
- `tests/` - Python and JS tests for pure logic.

## Building The Frida Agent

The agent source files are in `agent/src`. The root-level `chat_injector_agent.js` is committed already bundled so that `python chat_cli.py` works without requiring a JS build step.

If Node.js/npm is installed, rebuild the agent with:

```bash
npm install
npm run build:agent
```

## How It Works

The Frida agent hooks these system functions:

```text
send
sendto
recv
recvfrom
```

When the game sends or receives a UDP packet, the agent checks:

```text
packet[0] == 0x89
```

This is the chat packet opcode.

After detection, the packet is parsed as:

```text
u8      opcode (0x89)
u32be   public_id
MUTF8   alias
MUTF8   message
i32be   account_id / -1
bool    unknown
i64be   message_id
vararr  alias_colors
bool    show_broadcast_bubble
u8      alias_font
u32be   client_id
bool    false
bool    false
```

Strings are stored as:

```text
u16 (big-endian) + UTF-8 bytes
```

For outgoing messages, the new packet is sent through the same socket:

```text
sendto(fd, ...)   // when sockaddr is available
or
send(fd, ...)     // fallback
```

The packet tail is left unchanged:

```text
... ff ff ff ff 00 00 ...
```

It contains service data: flags, id, client state, and other fields.
