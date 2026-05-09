import { CHAT_KIND_BY_OPCODE, CHAT_LABEL_BY_KIND, MAX_PACKET_LEN } from "./constants.js";
import { parseChatFromPtr } from "./packet.js";
import { state } from "./state.js";

const DEDUPE_TTL_MS = 1200;
const MAX_INCOMING_NICK_BYTES = 64;
const MAX_INCOMING_MESSAGE_BYTES = 512;
const MAX_ACCOUNT_ID = 199999999;

function hexU32(v) {
    if (v === null || v === undefined) return null;
    return "0x" + ("00000000" + (v >>> 0).toString(16)).slice(-8);
}

function makeDedupeKey(info, displayId, packetLen, offset) {
    return [
        incomingKindForInfo(info),
        displayId,
        info.id1,
        info.id2,
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

function isCleanChatText(s, allowEmpty) {
    return (
        typeof s === "string" &&
        (allowEmpty || s.length > 0) &&
        s.indexOf("\ufffd") === -1 &&
        !hasControlChars(s)
    );
}

function isLikelyIncomingChat(info) {
    if (!info) return false;

    if (!isValidIncomingAccountId(info.accountId)) {
        return false;
    }

    if (
        info.msgLen <= 0 ||
        info.msgLen > MAX_INCOMING_MESSAGE_BYTES ||
        !isCleanChatText(info.msg, false)
    ) {
        return false;
    }

    return (
        info.nickLen > 0 &&
        info.nickLen <= MAX_INCOMING_NICK_BYTES &&
        isCleanChatText(info.nick, false)
    );
}

export function isValidIncomingAccountId(accountId) {
    if (accountId === null || accountId === undefined) {
        return true;
    }

    return accountId >= -1 && accountId <= MAX_ACCOUNT_ID;
}

function displayIdFor(info) {
    if (info.accountId !== null && info.accountId !== undefined) {
        return String(info.accountId);
    }

    if (info.id1 !== null && info.id1 !== undefined) {
        return String(info.id1);
    }

    return "unknown";
}

export function incomingKindForInfo(info) {
    if (
        info &&
        (
            info.accountId === -1 ||
            info.playerId === -1 ||
            info.id === -1
        )
    ) {
        return "game";
    }

    return info && info.kind ? info.kind : "game";
}

function emitChatMessage(sourceName, fd, len, offset, info) {
    const incomingKind = incomingKindForInfo(info);
    const publicIdHex = hexU32(info.publicId);
    const displayId = displayIdFor(info);
    const dedupeKey = makeDedupeKey(info, displayId, len, offset);

    if (isDuplicate(dedupeKey)) {
        return true;
    }

    const label = CHAT_LABEL_BY_KIND[incomingKind] || String(incomingKind || "chat").toUpperCase();
    const nick = info.nick || label.toLowerCase();

    const event = {
        kind: incomingKind,
        parsedKind: info.kind,
        label: label,
        direction: "recv",
        source: sourceName,
        fd: fd,
        packetLen: len,
        offset: offset,

        id: info.accountId,
        playerId: info.accountId,
        accountId: info.accountId,
        displayId: displayId,
        publicId: info.publicId,
        publicIdHex: publicIdHex,
        id1: info.id1,
        id2: info.id2,
        targetId: info.targetId,
        clanRole: info.clanRole,

        nick: nick,
        message: info.msg,
        nickLen: info.nickLen,
        msgLen: info.msgLen,

        receivedAtMs: Date.now()
    };

    state.incomingCount = (state.incomingCount || 0) + 1;

    if (!state.incomingCounts) {
        state.incomingCounts = {};
    }

    state.incomingCounts[incomingKind] = (state.incomingCounts[incomingKind] || 0) + 1;
    state.lastIncoming = event;

    send({
        type: "chat_message",
        payload: event,
        line:
            "[" + label + "] " +
            "[" + displayId + "] " +
            nick +
            ": " +
            info.msg
    });

    return true;
}

export function handleIncomingPacket(sourceName, fd, buf, len) {
    if (!state.recvEnabled) return false;
    if (len <= 0 || len > MAX_PACKET_LEN) return false;

    const firstOpcode = buf.readU8() & 0xff;

    if (CHAT_KIND_BY_OPCODE[firstOpcode] && emitIncomingAtOffset(sourceName, fd, buf, len, 0)) {
        return true;
    }

    let found = false;

    for (let offset = 1; offset < len; offset++) {
        const opcode = buf.add(offset).readU8() & 0xff;

        if (!CHAT_KIND_BY_OPCODE[opcode]) {
            continue;
        }

        found = emitIncomingAtOffset(sourceName, fd, buf, len, offset) || found;
    }

    return found;
}

function emitIncomingAtOffset(sourceName, fd, buf, len, offset) {
    const info = parseChatFromPtr(buf.add(offset), len - offset, "recv");

    if (!info) {
        return false;
    }

    if (!isLikelyIncomingChat(info)) {
        return false;
    }

    emitChatMessage(sourceName, fd, len, offset, info);
    return true;
}
