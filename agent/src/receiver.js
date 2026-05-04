import { CHAT_OPCODE, MAX_PACKET_LEN } from "./constants.js";
import { parseChatFromPtr } from "./packet.js";
import { state } from "./state.js";

const DEDUPE_TTL_MS = 1200;
const MAX_INCOMING_NICK_BYTES = 64;
const MAX_INCOMING_MESSAGE_BYTES = 512;

function hexU32(v) {
    return "0x" + ("00000000" + (v >>> 0).toString(16)).slice(-8);
}

function makeDedupeKey(info, playerIdText, publicIdHex, packetLen, offset) {
    return [
        playerIdText,
        publicIdHex,
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

function hasControlChars(s) {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);

        if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) {
            return true;
        }
    }

    return false;
}

function isCleanChatText(s) {
    return (
        typeof s === "string" &&
        s.length > 0 &&
        s.indexOf("\ufffd") === -1 &&
        !hasControlChars(s)
    );
}

function isLikelyIncomingChat(info) {
    return (
        info.nickLen > 0 &&
        info.nickLen <= MAX_INCOMING_NICK_BYTES &&
        info.msgLen > 0 &&
        info.msgLen <= MAX_INCOMING_MESSAGE_BYTES &&
        isCleanChatText(info.nick) &&
        isCleanChatText(info.msg)
    );
}

function emitChatMessage(sourceName, fd, buf, len, offset, info) {
    const publicId = info.publicId === null || info.publicId === undefined ? 0 : info.publicId;
    const publicIdHex = hexU32(publicId);
    const playerId = info.accountId;
    const playerIdText = playerId === null ? "unknown" : String(playerId);
    const dedupeKey = makeDedupeKey(info, playerIdText, publicIdHex, len, offset);

    if (isDuplicate(dedupeKey)) {
        return true;
    }

    const event = {
        direction: "recv",
        source: sourceName,
        fd: fd,
        packetLen: len,
        offset: offset,

        id: playerId,
        playerId: playerId,
        accountId: playerId,
        displayId: playerIdText,
        publicId: publicId,
        publicIdHex: publicIdHex,

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
            "[" + playerIdText + "] " +
            info.nick +
            ": " +
            info.msg
    });

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

        if (!isLikelyIncomingChat(info)) {
            continue;
        }

        emitChatMessage(sourceName, fd, buf, len, offset, info);
        found = true;
    }

    return found;
}
