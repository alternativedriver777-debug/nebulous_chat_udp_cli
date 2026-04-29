from __future__ import annotations

import shlex
import subprocess
import time
from dataclasses import dataclass
from typing import Callable, Sequence


@dataclass(frozen=True)
class AdbCommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""

    @property
    def output(self) -> str:
        return "\n".join(part for part in (self.stdout, self.stderr) if part)


@dataclass(frozen=True)
class AdbBootstrapResult:
    serial: str
    frida_server_started: bool


class AdbError(RuntimeError):
    pass


AdbRunner = Callable[[Sequence[str], float], AdbCommandResult]


def subprocess_runner(command: Sequence[str], timeout: float) -> AdbCommandResult:
    try:
        completed = subprocess.run(
            list(command),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except FileNotFoundError as exc:
        raise AdbError("adb executable was not found in PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise AdbError(f"command timed out: {' '.join(command)}") from exc

    return AdbCommandResult(
        returncode=completed.returncode,
        stdout=completed.stdout.strip(),
        stderr=completed.stderr.strip(),
    )


def bootstrap_adb_target(
    serial: str,
    frida_server_path: str,
    timeout: float,
    runner: AdbRunner = subprocess_runner,
) -> AdbBootstrapResult:
    check_adb_available(runner, timeout)
    adb_connect(serial, runner, timeout)
    wait_for_device(serial, runner, timeout)
    started = ensure_frida_server_running(serial, frida_server_path, runner, timeout)
    return AdbBootstrapResult(serial=serial, frida_server_started=started)


def check_adb_available(runner: AdbRunner, timeout: float) -> None:
    result = runner(("adb", "version"), timeout)
    if result.returncode != 0:
        raise AdbError(f"adb is not available: {result.output or 'adb version failed'}")


def adb_connect(serial: str, runner: AdbRunner, timeout: float) -> None:
    result = runner(("adb", "connect", serial), timeout)
    output = result.output.lower()

    if result.returncode != 0 or (
        "connected to" not in output and "already connected to" not in output
    ):
        raise AdbError(f"adb connect {serial} failed: {result.output or 'no output'}")


def wait_for_device(serial: str, runner: AdbRunner, timeout: float) -> None:
    result = runner(("adb", "-s", serial, "wait-for-device"), timeout)
    if result.returncode != 0:
        raise AdbError(f"adb wait-for-device failed for {serial}: {result.output or 'no output'}")


def ensure_frida_server_running(
    serial: str,
    frida_server_path: str,
    runner: AdbRunner,
    timeout: float,
) -> bool:
    if is_frida_server_running(serial, runner, timeout):
        return False

    ensure_remote_server_exists(serial, frida_server_path, runner, timeout)
    start_frida_server(serial, frida_server_path, runner, timeout)
    wait_until_frida_server_running(serial, runner, timeout)
    return True


def is_frida_server_running(serial: str, runner: AdbRunner, timeout: float) -> bool:
    result = adb_shell_su(serial, "pidof frida-server", runner, timeout)
    return result.returncode == 0 and bool(result.stdout.strip())


def ensure_remote_server_exists(
    serial: str,
    frida_server_path: str,
    runner: AdbRunner,
    timeout: float,
) -> None:
    quoted_path = shlex.quote(frida_server_path)
    result = adb_shell_su(serial, f"test -f {quoted_path}", runner, timeout)
    raise_for_su_error(result)

    if result.returncode != 0:
        raise AdbError(
            "frida-server was not found on Android target at "
            f"{frida_server_path!r}; put it there first and make it executable"
        )


def start_frida_server(
    serial: str,
    frida_server_path: str,
    runner: AdbRunner,
    timeout: float,
) -> None:
    quoted_path = shlex.quote(frida_server_path)
    result = adb_shell_su(
        serial,
        f"nohup {quoted_path} >/dev/null 2>&1 &",
        runner,
        timeout,
    )

    if result.returncode != 0:
        raise_for_su_error(result)
        raise AdbError(
            "failed to start frida-server through `su -c`: "
            f"{result.output or 'no output'}"
        )


def wait_until_frida_server_running(
    serial: str,
    runner: AdbRunner,
    timeout: float,
) -> None:
    deadline = time.monotonic() + timeout

    while True:
        if is_frida_server_running(serial, runner, timeout):
            return

        if time.monotonic() >= deadline:
            raise AdbError("frida-server did not become visible through pidof in time")

        time.sleep(0.25)


def adb_shell_su(
    serial: str,
    shell_command: str,
    runner: AdbRunner,
    timeout: float,
) -> AdbCommandResult:
    remote_command = f"su -c {shlex.quote(shell_command)}"
    return runner(("adb", "-s", serial, "shell", remote_command), timeout)


def raise_for_su_error(result: AdbCommandResult) -> None:
    output = result.output.lower()
    if "permission denied" in output or "su: not found" in output or "su: inaccessible" in output:
        raise AdbError(f"`su -c` failed on Android target: {result.output or 'no output'}")
