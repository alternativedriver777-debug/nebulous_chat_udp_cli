import {
    CHAT_KIND_BY_OPCODE,
    CHAT_KIND_CLAN,
    CHAT_KIND_GAME,
    CHAT_KIND_PRIVATE,
    CHAT_OPCODE,
    CHAT_OPCODE_BY_KIND
} from "./constants.js";
import { utf8Decode, utf8Encode } from "./utf8.js";

const MAX_ALIAS_BYTES = 1024;
const MAX_MESSAGE_BYTES = 4096;

export function readU16BEFromPtr(p) {
    const a = p.readU8();
    const b = p.add(1).readU8();
    return (a << 8) | b;
}

export function readU16BEFromArray(arr, off) {
    return ((arr[off] & 0xff) << 8) | (arr[off + 1] & 0xff);
}

export function readU32BEFromPtr(p) {
    return (
        ((p.readU8() & 0xff) << 24) |
        ((p.add(1).readU8() & 0xff) << 16) |
        ((p.add(2).readU8() & 0xff) << 8) |
        (p.add(3).readU8() & 0xff)
    ) >>> 0;
}

export function readI32BEFromPtr(p) {
    return (
        ((p.readU8() & 0xff) << 24) |
        ((p.add(1).readU8() & 0xff) << 16) |
        ((p.add(2).readU8() & 0xff) << 8) |
        (p.add(3).readU8() & 0xff)
    );
}

export function readI32BEFromArray(arr, off) {
    return (
        ((arr[off] & 0xff) << 24) |
        ((arr[off + 1] & 0xff) << 16) |
        ((arr[off + 2] & 0xff) << 8) |
        (arr[off + 3] & 0xff)
    );
}

export function readU32BEFromArray(arr, off) {
    return readI32BEFromArray(arr, off) >>> 0;
}

export function writeU16BEToArray(arr, off, v) {
    arr[off] = (v >> 8) & 0xff;
    arr[off + 1] = v & 0xff;
}

export function writeI32BEToArray(arr, off, v) {
    arr[off] = (v >> 24) & 0xff;
    arr[off + 1] = (v >> 16) & 0xff;
    arr[off + 2] = (v >> 8) & 0xff;
    arr[off + 3] = v & 0xff;
}

function ptrToArray(buf, len) {
    const arr = [];

    for (let i = 0; i < len; i++) {
        arr.push(buf.add(i).readU8());
    }

    return arr;
}

function readMutf8FromArray(arr, lenOffset, maxLen) {
    if (lenOffset + 2 > arr.length) return null;

    const byteLen = readU16BEFromArray(arr, lenOffset);
    if (byteLen < 0 || byteLen > maxLen) return null;

    const start = lenOffset + 2;
    const end = start + byteLen;
    if (end > arr.length) return null;

    return {
        lenOffset: lenOffset,
        start: start,
        len: byteLen,
        end: end,
        bytes: arr.slice(start, end),
        text: utf8Decode(arr.slice(start, end))
    };
}

function hasReplacementChar(s) {
    return String(s).indexOf("\ufffd") >= 0;
}

function parseTwoStringPacket(arr, kind, options) {
    options = options || {};

    if (!arr || arr.length < 9) return null;

    const expectedOpcode = CHAT_OPCODE_BY_KIND[kind];
    const opcode = arr[0] & 0xff;

    if (opcode !== expectedOpcode) return null;

    const u32Field = readU32BEFromArray(arr, 1);
    const first = readMutf8FromArray(arr, 5, MAX_ALIAS_BYTES);
    if (!first) return null;

    const second = readMutf8FromArray(arr, first.end, MAX_MESSAGE_BYTES);
    if (!second) return null;

    if (hasReplacementChar(first.text) || hasReplacementChar(second.text)) {
        return null;
    }

    const msgEnd = second.end;
    let accountId = null;
    let accountIdOffset = msgEnd;
    let clanRole = null;

    if (kind === CHAT_KIND_CLAN) {
        if (msgEnd + 5 <= arr.length) {
            clanRole = arr[msgEnd] & 0xff;
            accountId = readI32BEFromArray(arr, msgEnd + 1);
            accountIdOffset = msgEnd + 1;
        }
    } else if (msgEnd + 4 <= arr.length) {
        accountId = readI32BEFromArray(arr, msgEnd);
    }

    return makeChatInfo({
        kind: kind,
        opcode: opcode,
        packetLen: arr.length,
        publicId: u32Field,
        id1: u32Field,
        id2: null,
        accountId: accountId,
        accountIdOffset: accountIdOffset,
        clanRole: clanRole,
        nickInfo: first,
        msgInfo: second,
        tailOffset: msgEnd,
        targetIdOffsets: []
    });
}

function parsePrivateChatFromArray(arr) {
    if (!arr || arr.length < 9) return null;
    if ((arr[0] & 0xff) !== CHAT_OPCODE_BY_KIND.private) return null;

    // Probe results confirm private packets as:
    //   SEND: target ids + emptyAlias + msg
    //   RECV: senderId + targetId + nick + msg
    // Different builds/devices may include one, two, or three i32 id fields
    // before the two MUTF8 strings, so try all sane id-prefix widths.
    const idCounts = [2, 1, 3];

    for (let i = 0; i < idCounts.length; i++) {
        const parsed = parsePrivateVariant(arr, idCounts[i]);
        if (parsed) return parsed;
    }

    return null;
}

function parsePrivateVariant(arr, idCount) {
    const stringOffset = 1 + (idCount * 4);
    if (stringOffset + 4 > arr.length) return null;

    const first = readMutf8FromArray(arr, stringOffset, MAX_ALIAS_BYTES);
    if (!first) return null;

    const second = readMutf8FromArray(arr, first.end, MAX_MESSAGE_BYTES);
    if (!second || second.len <= 0) return null;

    if (hasReplacementChar(first.text) || hasReplacementChar(second.text)) {
        return null;
    }

    const ids = [];
    const targetIdOffsets = [];

    for (let i = 0; i < idCount; i++) {
        const off = 1 + (i * 4);
        ids.push(readI32BEFromArray(arr, off));
        targetIdOffsets.push(off);
    }

    const id1 = ids.length > 0 ? ids[0] : null;
    const id2 = ids.length > 1 ? ids[1] : null;

    return makeChatInfo({
        kind: CHAT_KIND_PRIVATE,
        opcode: arr[0] & 0xff,
        packetLen: arr.length,
        publicId: null,
        id1: id1,
        id2: id2,
        accountId: id1,
        accountIdOffset: targetIdOffsets.length > 0 ? targetIdOffsets[0] : null,
        clanRole: null,
        nickInfo: first,
        msgInfo: second,
        tailOffset: second.end,
        targetIdOffsets: targetIdOffsets
    });
}

function makeChatInfo(values) {
    const nick = values.nickInfo;
    const msg = values.msgInfo;

    return {
        kind: values.kind,
        opcode: values.opcode,

        publicId: values.publicId,
        id1: values.id1,
        id2: values.id2,
        targetId: values.id2 === null || values.id2 === undefined ? values.id1 : values.id2,
        accountId: values.accountId,
        accountIdOffset: values.accountIdOffset,
        clanRole: values.clanRole,

        nickLenOffset: nick.lenOffset,
        nickStart: nick.start,
        nickLen: nick.len,
        nickEnd: nick.end,

        msgLenOffset: msg.lenOffset,
        msgStart: msg.start,
        msgLen: msg.len,
        msgEnd: msg.end,

        tailOffset: values.tailOffset,
        tailLen: values.packetLen - values.tailOffset,

        nick: nick.text,
        msg: msg.text,
        targetIdOffsets: values.targetIdOffsets || []
    };
}

export function parseChatFromPtr(buf, len, direction) {
    try {
        if (len <= 0) return null;
        return parseChatFromArray(ptrToArray(buf, len), direction);
    } catch (e) {
        console.log("[CHAT] parseChatFromPtr error: " + e);
        return null;
    }
}

export function parseChatFromArray(arr, direction) {
    if (!arr || arr.length < 7) return null;

    const opcode = arr[0] & 0xff;
    const kind = CHAT_KIND_BY_OPCODE[opcode];
    if (!kind) return null;

    if (kind === CHAT_KIND_GAME) {
        return parseTwoStringPacket(arr, CHAT_KIND_GAME, { direction: direction });
    }

    if (kind === CHAT_KIND_CLAN) {
        return parseTwoStringPacket(arr, CHAT_KIND_CLAN, { direction: direction });
    }

    if (kind === CHAT_KIND_PRIVATE) {
        return parsePrivateChatFromArray(arr, direction);
    }

    return null;
}

export function buildChatMessage(template, newText, maxLenBytes, options) {
    if (!template || !template.packet) {
        throw new Error("template is not captured yet");
    }

    const info = parseChatFromArray(template.packet, "send");

    if (!info) {
        throw new Error("cannot parse saved template");
    }

    const msgBytes = utf8Encode(String(newText));

    if (msgBytes.length <= 0) {
        throw new Error("empty message is not allowed");
    }

    if (msgBytes.length > maxLenBytes) {
        throw new Error(
            "message too long: " +
            msgBytes.length +
            " bytes, maxLenBytes=" +
            maxLenBytes
        );
    }

    if (msgBytes.length > 0xffff) {
        throw new Error("message too long for u16 field");
    }

    const packet = template.packet;
    const prefixLen = info.msgLenOffset;
    const oldTailLen = packet.length - info.msgEnd;

    const newLen = prefixLen + 2 + msgBytes.length + oldTailLen;
    const out = new Array(newLen);

    for (let i = 0; i < prefixLen; i++) {
        out[i] = packet[i] & 0xff;
    }

    applyTargetOptions(out, info, options || {});
    writeU16BEToArray(out, prefixLen, msgBytes.length);

    const newMsgStart = prefixLen + 2;

    for (let i = 0; i < msgBytes.length; i++) {
        out[newMsgStart + i] = msgBytes[i] & 0xff;
    }

    const newTailStart = newMsgStart + msgBytes.length;

    for (let i = 0; i < oldTailLen; i++) {
        out[newTailStart + i] = packet[info.msgEnd + i] & 0xff;
    }

    const newInfo = parseChatFromArray(out, "send");

    return {
        packet: out,
        kind: info.kind,
        msgBytesLen: msgBytes.length,
        targetId: newInfo ? newInfo.targetId : info.targetId
    };
}

function applyTargetOptions(out, info, options) {
    if (info.kind !== CHAT_KIND_PRIVATE) {
        return;
    }

    if (options.targetId === null || options.targetId === undefined || options.targetId === "") {
        return;
    }

    const targetId = parseInt(options.targetId, 10);
    if (!isFinite(targetId)) {
        throw new Error("targetId must be an integer");
    }

    const mode = String(options.targetField || "second").toLowerCase();
    const offsets = info.targetIdOffsets || [];

    if (offsets.length === 0) {
        throw new Error("template has no target id fields");
    }

    if (mode === "first") {
        writeI32BEToArray(out, offsets[0], targetId);
        return;
    }

    if (mode === "both") {
        for (let i = 0; i < offsets.length; i++) {
            writeI32BEToArray(out, offsets[i], targetId);
        }
        return;
    }

    const index = offsets.length > 1 ? 1 : 0;
    writeI32BEToArray(out, offsets[index], targetId);
}
