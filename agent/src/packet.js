import { CHAT_OPCODE } from "./constants.js";
import { utf8Decode, utf8Encode } from "./utf8.js";

export function readU16BEFromPtr(p) {
    const a = p.readU8();
    const b = p.add(1).readU8();
    return (a << 8) | b;
}

export function readU16BEFromArray(arr, off) {
    return ((arr[off] & 0xff) << 8) | (arr[off + 1] & 0xff);
}

export function writeU16BEToArray(arr, off, v) {
    arr[off] = (v >> 8) & 0xff;
    arr[off + 1] = v & 0xff;
}

export function parseChatFromPtr(buf, len) {
    try {
        if (len < 12) return null;

        const opcode = buf.readU8();

        if (opcode !== CHAT_OPCODE) {
            return null;
        }

        const nickLenOffset = 5;
        const nickStart = 7;

        if (nickLenOffset + 2 > len) return null;

        const nickLen = readU16BEFromPtr(buf.add(nickLenOffset));
        const nickEnd = nickStart + nickLen;

        if (nickLen < 0 || nickLen > 1024) {
            return null;
        }

        if (nickEnd + 2 > len) {
            return null;
        }

        const msgLenOffset = nickEnd;
        const msgLen = readU16BEFromPtr(buf.add(msgLenOffset));
        const msgStart = msgLenOffset + 2;
        const msgEnd = msgStart + msgLen;

        if (msgLen < 0 || msgLen > 4096) {
            return null;
        }

        if (msgEnd > len) {
            return null;
        }

        const nickBytes = [];
        for (let i = 0; i < nickLen; i++) {
            nickBytes.push(buf.add(nickStart + i).readU8());
        }

        const msgBytes = [];
        for (let i = 0; i < msgLen; i++) {
            msgBytes.push(buf.add(msgStart + i).readU8());
        }

        return makeChatInfo(len, nickLenOffset, nickStart, nickLen, msgLenOffset, msgStart, msgLen, nickBytes, msgBytes);

    } catch (e) {
        console.log("[CHAT] parseChatFromPtr error: " + e);
        return null;
    }
}

export function parseChatFromArray(arr) {
    if (!arr || arr.length < 12) return null;
    if ((arr[0] & 0xff) !== CHAT_OPCODE) return null;

    const nickLenOffset = 5;
    const nickStart = 7;

    const nickLen = readU16BEFromArray(arr, nickLenOffset);
    const nickEnd = nickStart + nickLen;

    if (nickLen < 0 || nickLen > 1024) return null;
    if (nickEnd + 2 > arr.length) return null;

    const msgLenOffset = nickEnd;
    const msgLen = readU16BEFromArray(arr, msgLenOffset);
    const msgStart = msgLenOffset + 2;
    const msgEnd = msgStart + msgLen;

    if (msgLen < 0 || msgLen > 4096) return null;
    if (msgEnd > arr.length) return null;

    const nickBytes = arr.slice(nickStart, nickEnd);
    const msgBytes = arr.slice(msgStart, msgEnd);

    return makeChatInfo(arr.length, nickLenOffset, nickStart, nickLen, msgLenOffset, msgStart, msgLen, nickBytes, msgBytes);
}

function makeChatInfo(packetLen, nickLenOffset, nickStart, nickLen, msgLenOffset, msgStart, msgLen, nickBytes, msgBytes) {
    const nickEnd = nickStart + nickLen;
    const msgEnd = msgStart + msgLen;

    return {
        nickLenOffset: nickLenOffset,
        nickStart: nickStart,
        nickLen: nickLen,
        nickEnd: nickEnd,

        msgLenOffset: msgLenOffset,
        msgStart: msgStart,
        msgLen: msgLen,
        msgEnd: msgEnd,

        tailOffset: msgEnd,
        tailLen: packetLen - msgEnd,

        nick: utf8Decode(nickBytes),
        msg: utf8Decode(msgBytes)
    };
}

export function buildChatMessage(template, newText, maxLenBytes) {
    if (!template || !template.packet) {
        throw new Error("template is not captured yet");
    }

    const info = parseChatFromArray(template.packet);

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

    writeU16BEToArray(out, prefixLen, msgBytes.length);

    const newMsgStart = prefixLen + 2;

    for (let i = 0; i < msgBytes.length; i++) {
        out[newMsgStart + i] = msgBytes[i] & 0xff;
    }

    const newTailStart = newMsgStart + msgBytes.length;

    for (let i = 0; i < oldTailLen; i++) {
        out[newTailStart + i] = packet[info.msgEnd + i] & 0xff;
    }

    return {
        packet: out,
        msgBytesLen: msgBytes.length
    };
}
