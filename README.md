# Инжектор чата Nebulous.io

CLI-инструмент для отправки сообщений в чат Nebulous.io через Frida.

Сначала агент перехватывает реальный UDP-пакет сообщения из игры и сохраняет его как template. После этого CLI может собирать новые chat-пакеты на основе того же сетевого контекста клиента и отправлять их через `sendto` или `send`.

## Требования

- Python 3.9+.
- Python-пакет `frida`.
- `adb` в `PATH`.
- Android-устройство или Android-эмулятор, который виден через `adb`.
- `frida-server`, уже положенный на Android-цель, обычно в `/data/local/tmp/frida-server`.
- Root-доступ через `adb shell su -c ...` для запуска `frida-server`.
- Запущенная игра Nebulous.io.

Конкретный эмулятор не важен. Подойдёт любой эмулятор или физическое Android-устройство, если `adb devices` его видит, версия `frida-server` совместима с установленным Python-пакетом `frida`, а процесс игры доступен для attach.

## Запуск

Обычный USB/ADB flow, если устройство уже видно Frida:

```bash
python chat_cli.py
```

TCP/ADB flow, если нужно сначала подключиться к цели по `ip:port`:

```bash
python chat_cli.py --adb 127.0.0.1:62001
```

Кастомный путь к `frida-server` на Android-цели:

```bash
python chat_cli.py --adb 127.0.0.1:62001 --frida-server-path /data/local/tmp/frida-server
```

Также доступен пакетный запуск:

```bash
python -m nebulous_chat_cli --adb 127.0.0.1:62001
```

Внутри CLI есть команда `/help`.

## ADB TCP И Frida-Server

При запуске с `--adb HOST:PORT` программа делает:

1. Проверяет доступность `adb`.
2. Выполняет `adb connect HOST:PORT`.
3. Выполняет `adb -s HOST:PORT wait-for-device`.
4. Проверяет `frida-server` через `adb -s HOST:PORT shell su -c "pidof frida-server"`.
5. Если сервер не запущен, стартует его через `su -c`:

```bash
adb -s HOST:PORT shell su -c "nohup /data/local/tmp/frida-server >/dev/null 2>&1 &"
```

6. Ждёт появления Frida device с id `HOST:PORT`.
7. Делает attach к процессу `Nebulous.io`.

Важно: CLI не скачивает и не загружает `frida-server` автоматически. Бинарник должен уже лежать на устройстве или в эмуляторе. Если используется Android Wireless Debugging с pairing, `adb pair` нужно выполнить заранее; CLI автоматизирует только `adb connect HOST:PORT`.

## Как Использовать

1. Запусти Android-эмулятор или подключи устройство.
2. Убедись, что цель видна через ADB:

```bash
adb devices
```

3. Убедись, что `frida-server` лежит на Android-цели, например:

```bash
adb -s 127.0.0.1:62001 shell su -c "ls -l /data/local/tmp/frida-server"
```

4. Открой Nebulous.io и зайди в комнату.
5. Запусти CLI:

```bash
python chat_cli.py --adb 127.0.0.1:62001
```

6. В игре вручную отправь любое сообщение в общий чат.
7. Дождись в консоли лога вида:

```text
[CHAT TEMPLATE] source=sendto fd=... nick="..." msg="hello"
```

8. Теперь можно писать сообщения прямо в CLI:

```text
> test
> привет
> yoo how are you
```

## Команды CLI

```text
/status        показать состояние template/fd/nick/rate/max
/max 128       установить maxLenBytes
/rate 1000     установить rate-limit в миллисекундах
/clear         сбросить пойманный template
/help          показать помощь
/exit          выйти
/quit          выйти
```

Обычный текст без `/` отправляется в чат через Frida RPC.

## Структура Проекта

- `chat_cli.py` - совместимый entrypoint для запуска.
- `nebulous_chat_cli/` - Python-пакет с CLI, командами, ADB bootstrap и Frida lifecycle.
- `agent/src/` - исходники Frida-агента по модулям.
- `chat_injector_agent.js` - собранный агент, который загружает CLI.
- `tests/` - Python и JS тесты для чистой логики.

## Сборка Frida-Агента

Исходники агента находятся в `agent/src`. Корневой `chat_injector_agent.js` хранится в репозитории уже собранным, чтобы `python chat_cli.py` работал без обязательной JS-сборки.

Если установлен Node.js/npm, агент можно пересобрать так:

```bash
npm install
npm run build:agent
```

## Как Работает

Frida-агент подключается к системным функциям:

```text
send
sendto
```

Когда игра отправляет UDP-пакет, агент проверяет:

```text
packet[0] == 0x89
```

Это opcode chat-пакета.

После обнаружения пакет разбирается так:

```text
0x00    opcode (0x89)
0x01-04 session / unknown bytes
0x05-06 nickLen (u16 BE)
...     nickname
...     msgLen (u16 BE)
...     message
...     tail (служебные данные)
```

Строки хранятся как:

```text
u16 (big-endian) + UTF-8 bytes
```

Новый пакет отправляется через тот же socket:

```text
sendto(fd, ...)   // если есть sockaddr
или
send(fd, ...)     // fallback
```

Tail пакета не меняется:

```text
... ff ff ff ff 00 00 ...
```

Он содержит служебные данные: flags, id, состояние клиента и другие поля.
