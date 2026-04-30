import { CHAT_OPCODE, MAX_PACKET_LEN } from "./constants.js";
import { parseChatFromPtr } from "./packet.js";
import { state } from "./state.js";
import { quote } from "./utils.js";

const DEDUPE_TTL_MS = 1200;

function readU32BEFromPtr(p) {
    return (
        ((p.readU8() & 0xff) << 24) |
        ((p.add(1).readU8() & 0xff) << 16) |
        ((p.add(2).readU8() & 0xff) << 8) |
        (p.add(3).readU8() & 0xff)
    ) >>> 0;
}

function hexU32(v) {
    return "0x" + ("00000000" + (v >>> 0).toString(16)).slice(-8);
}

function makeDedupeKey(info, idHex, packetLen, offset) {
    return [
        idHex,
        info.nick,
        info.msg,
        info.msgLen,
        packetLen,
        offset
    ].join("|");
}

function isDuplicate(key) {
    const now = Date.now();

    if (!state.incomingDedupe) {
        state.incomingDedupe = {};
    }

    const last = state.incomingDedupe[key] || 0;
    state.incomingDedupe[key] = now;

    for (const k in state.incomingDedupe) {
        if (now - state.incomingDedupe[k] > DEDUPE_TTL_MS) {
            delete state.incomingDedupe[k];
        }
    }

    return now - last < DEDUPE_TTL_MS;
}

function emitChatMessage(sourceName, fd, buf, len, offset, info) {
    let idValue = 0;

    try {
        idValue = readU32BEFromPtr(buf.add(offset + 1));
    } catch (_) {
        idValue = 0;
    }

    const idHex = hexU32(idValue);
    const dedupeKey = makeDedupeKey(info, idHex, len, offset);

    if (isDuplicate(dedupeKey)) {
        return true;
    }

    const event = {
        direction: "recv",
        source: sourceName,
        fd: fd,
        packetLen: len,
        offset: offset,

        id: idValue,
        idHex: idHex,

        nick: info.nick,
        message: info.msg,
        nickLen: info.nickLen,
        msgLen: info.msgLen,

        receivedAtMs: Date.now()
    };

    state.incomingCount = (state.incomingCount || 0) + 1;
    state.lastIncoming = event;

    send({
        type: "chat_message",
        payload: event,
        line:
            "[CHAT] " +
            "[" + idHex + "] " +
            info.nick +
            ": " +
            info.msg
    });

    console.log(
        "[CHAT IN] source=" + sourceName +
        " fd=" + fd +
        " len=" + len +
        " off=0x" + offset.toString(16) +
        " id=" + idHex +
        " nick=" + quote(info.nick) +
        " msg=" + quote(info.msg)
    );

    return true;
}

export function handleIncomingPacket(sourceName, fd, buf, len) {
    if (!state.recvEnabled) return false;
    if (len <= 0 || len > MAX_PACKET_LEN) return false;

    let found = false;

    for (let offset = 0; offset < len; offset++) {
        if ((buf.add(offset).readU8() & 0xff) !== CHAT_OPCODE) {
            continue;
        }

        const info = parseChatFromPtr(buf.add(offset), len - offset);

        if (!info) {
            continue;
        }

        emitChatMessage(sourceName, fd, buf, len, offset, info);
        found = true;
    }

    return found;
}
