# Nebulous.io Chat Injector

<p align="center">
  <img src="https://github.com/user-attachments/assets/0dd68859-74e2-40b1-b492-e29604f27557" width="70%" />
</p>

A CLI tool for sending messages to the Nebulous.io chat through Frida.

The Frida agent first intercepts a real UDP chat packet from the game and stores it as a template. After that, the CLI can build new chat packets from the same client network context and send them through `sendto` or `send`.

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

## CLI Commands

```text
/status        show the template/fd/nick/rate/max state
/max 128       set maxLenBytes
/rate 1000     set the rate limit in milliseconds
/clear         clear the captured template
/help          show help
/exit          exit
/quit          exit
```

Plain text without a leading `/` is sent to the chat through Frida RPC.

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
```

When the game sends a UDP packet, the agent checks:

```text
packet[0] == 0x89
```

This is the chat packet opcode.

After detection, the packet is parsed as:

```text
0x00    opcode (0x89)
0x01-04 session / unknown bytes
0x05-06 nickLen (u16 BE)
...     nickname
...     msgLen (u16 BE)
...     message
...     tail (service data)
```

Strings are stored as:

```text
u16 (big-endian) + UTF-8 bytes
```

The new packet is sent through the same socket:

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
