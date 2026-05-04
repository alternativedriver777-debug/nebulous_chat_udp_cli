from __future__ import annotations

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent

PROCESS_NAME = "Nebulous.io"
AGENT_FILE = PROJECT_ROOT / "chat_injector_agent.js"
CHAT_COLORS_FILE = PROJECT_ROOT / "chat_colors.json"
CHAT_LOG_DIR = PROJECT_ROOT / "logs"
DEFAULT_FRIDA_SERVER_PATH = "/data/local/tmp/frida-server"
DEFAULT_ADB_TIMEOUT = 10.0
DEFAULT_FRIDA_TIMEOUT = 8.0
