'use strict';

// Generated from agent/src/*.js. Run `npm run build:agent` when Node/npm is available.
(function () {

// agent/src/constants.js
const CHAT_OPCODE = 0x89;
const CHAT_KIND_GAME = "game";
const CHAT_KIND_CLAN = "clan";
const CHAT_KIND_PRIVATE = "private";
const CHAT_KIND_ALL = "all";

const CHAT_KINDS = [
    CHAT_KIND_GAME,
    CHAT_KIND_CLAN,
    CHAT_KIND_PRIVATE
];

const CHAT_OPCODE_BY_KIND = {
    game: 0x89,
    clan: 0x09,
    private: 0x24
};

const CHAT_KIND_BY_OPCODE = {
    0x89: CHAT_KIND_GAME,
    0x09: CHAT_KIND_CLAN,
    0x24: CHAT_KIND_PRIVATE
};

const CHAT_LABEL_BY_KIND = {
    game: "CHAT",
    clan: "CLAN",
    private: "PM"
};

const DEFAULT_SEND_KIND = CHAT_KIND_GAME;
const MAX_PACKET_LEN = 8192;
const HARD_MAX_MESSAGE_BYTES = 4096;
const DEFAULT_MAX_LEN_BYTES = 128;
const DEFAULT_RATE_LIMIT_MS = 1000;

// agent/src/state.js
const state = {
    maxLenBytes: DEFAULT_MAX_LEN_BYTES,
    rateLimitMs: DEFAULT_RATE_LIMIT_MS,
    sendKind: DEFAULT_SEND_KIND,

    injecting: false,
    lastInjectAtMs: 0,
    chatTemplate: null,
    chatTemplates: {},

    recvEnabled: true,
    incomingCount: 0,
    incomingCounts: {},
    lastIncoming: null,
    incomingDedupe: {}
};

// agent/src/utils.js
function nowMs() {
    return Date.now();
}

function quote(s) {
    try {
        return JSON.stringify(String(s));
    } catch (_) {
        return '"' + String(s) + '"';
    }
}

// agent/src/utf8.js
function codePointToString(cp) {
    if (cp <= 0xffff) {
        return String.fromCharCode(cp);
    }

    cp -= 0x10000;
    return String.fromCharCode(
        0xd800 + ((cp >> 10) & 0x3ff),
        0xdc00 + (cp & 0x3ff)
    );
}

function utf8Decode(bytes) {
    let out = "";

    for (let i = 0; i < bytes.length;) {
        const b0 = bytes[i] & 0xff;

        if (b0 <= 0x7f) {
            out += String.fromCharCode(b0);
            i++;
            continue;
        }

        if ((b0 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
            const b1 = bytes[i + 1] & 0xff;

            if ((b1 & 0xc0) === 0x80) {
                const cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
                out += codePointToString(cp);
                i += 2;
                continue;
            }
        }

        if ((b0 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
            const b1 = bytes[i + 1] & 0xff;
            const b2 = bytes[i + 2] & 0xff;

            if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80) {
                const cp = ((b0 & 0x0f) << 12) |
                           ((b1 & 0x3f) << 6) |
                           (b2 & 0x3f);

                out += codePointToString(cp);
                i += 3;
                continue;
            }
        }

        if ((b0 & 0xf8) === 0xf0 && i + 3 < bytes.length) {
            const b1 = bytes[i + 1] & 0xff;
            const b2 = bytes[i + 2] & 0xff;
            const b3 = bytes[i + 3] & 0xff;

            if (
                (b1 & 0xc0) === 0x80 &&
                (b2 & 0xc0) === 0x80 &&
                (b3 & 0xc0) === 0x80
            ) {
                const cp = ((b0 & 0x07) << 18) |
                           ((b1 & 0x3f) << 12) |
                           ((b2 & 0x3f) << 6) |
                           (b3 & 0x3f);

                out += codePointToString(cp);
                i += 4;
                continue;
            }
        }

        out += "\ufffd";
        i++;
    }

    return out;
}

function utf8Encode(text) {
    const s = String(text);
    const out = [];

    for (let i = 0; i < s.length; i++) {
        let cp = s.charCodeAt(i);

        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
            const lo = s.charCodeAt(i + 1);

            if (lo >= 0xdc00 && lo <= 0xdfff) {
                cp = 0x10000 + (((cp - 0xd800) << 10) | (lo - 0xdc00));
                i++;
            }
        }

        if (cp <= 0x7f) {
            out.push(cp);
        } else if (cp <= 0x7ff) {
            out.push(
                0xc0 | (cp >> 6),
                0x80 | (cp & 0x3f)
            );
        } else if (cp <= 0xffff) {
            out.push(
                0xe0 | (cp >> 12),
                0x80 | ((cp >> 6) & 0x3f),
                0x80 | (cp & 0x3f)
            );
        } else {
            out.push(
                0xf0 | (cp >> 18),
                0x80 | ((cp >> 12) & 0x3f),
                0x80 | ((cp >> 6) & 0x3f),
                0x80 | (cp & 0x3f)
            );
        }
    }

    return out;
}

// agent/src/packet.js
const MAX_ALIAS_BYTES = 1024;
const MAX_MESSAGE_BYTES = 4096;

function readU16BEFromPtr(p) {
    const a = p.readU8();
    const b = p.add(1).readU8();
    return (a << 8) | b;
}

function readU16BEFromArray(arr, off) {
    return ((arr[off] & 0xff) << 8) | (arr[off + 1] & 0xff);
}

function readU32BEFromPtr(p) {
    return (
        ((p.readU8() & 0xff) << 24) |
        ((p.add(1).readU8() & 0xff) << 16) |
        ((p.add(2).readU8() & 0xff) << 8) |
        (p.add(3).readU8() & 0xff)
    ) >>> 0;
}

function readI32BEFromPtr(p) {
    return (
        ((p.readU8() & 0xff) << 24) |
        ((p.add(1).readU8() & 0xff) << 16) |
        ((p.add(2).readU8() & 0xff) << 8) |
        (p.add(3).readU8() & 0xff)
    );
}

function readI32BEFromArray(arr, off) {
    return (
        ((arr[off] & 0xff) << 24) |
        ((arr[off + 1] & 0xff) << 16) |
        ((arr[off + 2] & 0xff) << 8) |
        (arr[off + 3] & 0xff)
    );
}

function readU32BEFromArray(arr, off) {
    return readI32BEFromArray(arr, off) >>> 0;
}

function writeU16BEToArray(arr, off, v) {
    arr[off] = (v >> 8) & 0xff;
    arr[off + 1] = v & 0xff;
}

function writeI32BEToArray(arr, off, v) {
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

function parseChatFromPtr(buf, len, direction) {
    try {
        if (len <= 0) return null;
        return parseChatFromArray(ptrToArray(buf, len), direction);
    } catch (e) {
        console.log("[CHAT] parseChatFromPtr error: " + e);
        return null;
    }
}

function parseChatFromArray(arr, direction) {
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

function buildChatMessage(template, newText, maxLenBytes, options) {
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

// agent/src/memory.js
function ptrToArray(buf, len) {
    const arr = [];

    for (let i = 0; i < len; i++) {
        arr.push(buf.add(i).readU8());
    }

    return arr;
}

function arrayToMemory(arr) {
    const p = Memory.alloc(arr.length);

    for (let i = 0; i < arr.length; i++) {
        p.add(i).writeU8(arr[i] & 0xff);
    }

    return p;
}

function copySockaddrToArray(sockaddr, sockaddrLen) {
    if (!sockaddr || sockaddr.isNull()) return null;
    if (sockaddrLen <= 0 || sockaddrLen > 128) return null;

    const arr = [];

    try {
        for (let i = 0; i < sockaddrLen; i++) {
            arr.push(sockaddr.add(i).readU8());
        }
    } catch (e) {
        console.log("[sockaddr] copy failed: " + e);
        return null;
    }

    return arr;
}

function sockaddrArrayToMemory(arr) {
    if (!arr || arr.length <= 0) return null;
    return arrayToMemory(arr);
}

// agent/src/native.js
function findExport(name) {
    try {
        const p = Module.getGlobalExportByName(name);
        console.log("[+] found global export: " + name + " -> " + p);
        return p;
    } catch (e) {
        console.log("[-] getGlobalExportByName failed for " + name + ": " + e);
    }

    try {
        if (typeof Module.findGlobalExportByName === "function") {
            const p = Module.findGlobalExportByName(name);
            if (p && !p.isNull()) {
                console.log("[+] found global export via findGlobalExportByName: " + name + " -> " + p);
                return p;
            }
        }
    } catch (_) {}

    try {
        const libc = Process.getModuleByName("libc.so");
        if (libc && typeof libc.findExportByName === "function") {
            const p = libc.findExportByName(name);
            if (p && !p.isNull()) {
                console.log("[+] found libc export: " + name + " -> " + p);
                return p;
            }
        }
    } catch (_) {}

    try {
        if (typeof Module.findExportByName === "function") {
            const p = Module.findExportByName("libc.so", name);
            if (p && !p.isNull()) {
                console.log("[+] found libc export via Module.findExportByName: " + name + " -> " + p);
                return p;
            }
        }
    } catch (_) {}

    console.log("[-] export not found: " + name);
    return null;
}

function createNativeApi() {
    const sendPtr = findExport("send");
    const sendtoPtr = findExport("sendto");
    const recvPtr = findExport("recv");
    const recvfromPtr = findExport("recvfrom");

    if (!sendPtr || !sendtoPtr) {
        throw new Error("send/sendto not found");
    }

    if (!recvPtr && !recvfromPtr) {
        console.log("[!] recv/recvfrom not found; incoming chat will be disabled");
    }

    return {
        sendPtr: sendPtr,
        sendtoPtr: sendtoPtr,
        recvPtr: recvPtr,
        recvfromPtr: recvfromPtr,
        sendNative: new NativeFunction(sendPtr, "int", [
            "int",
            "pointer",
            "int",
            "int"
        ]),
        sendtoNative: new NativeFunction(sendtoPtr, "int", [
            "int",
            "pointer",
            "int",
            "int",
            "pointer",
            "int"
        ])
    };
}

// agent/src/template.js
function findSockaddrForFd(fd, preferredKind) {
    const templates = state.chatTemplates || {};

    if (
        preferredKind &&
        templates[preferredKind] &&
        templates[preferredKind].fd === fd &&
        templates[preferredKind].sockaddrArray &&
        templates[preferredKind].sockaddrLen > 0
    ) {
        return {
            sockaddrArray: templates[preferredKind].sockaddrArray.slice(0),
            sockaddrLen: templates[preferredKind].sockaddrLen
        };
    }

    for (const kind in templates) {
        const template = templates[kind];

        if (
            template &&
            template.fd === fd &&
            template.sockaddrArray &&
            template.sockaddrLen > 0
        ) {
            return {
                sockaddrArray: template.sockaddrArray.slice(0),
                sockaddrLen: template.sockaddrLen
            };
        }
    }

    if (
        state.chatTemplate &&
        state.chatTemplate.fd === fd &&
        state.chatTemplate.sockaddrArray &&
        state.chatTemplate.sockaddrLen > 0
    ) {
        return {
            sockaddrArray: state.chatTemplate.sockaddrArray.slice(0),
            sockaddrLen: state.chatTemplate.sockaddrLen
        };
    }

    return {
        sockaddrArray: null,
        sockaddrLen: 0
    };
}

function saveTemplate(sourceName, fd, buf, len, info, sockaddr, sockaddrLen) {
    const packet = ptrToArray(buf, len);
    const kind = info.kind || "game";

    let sockaddrArray = null;
    let safeSockaddrLen = 0;

    if (sourceName === "sendto" && sockaddr && !sockaddr.isNull() && sockaddrLen > 0) {
        sockaddrArray = copySockaddrToArray(sockaddr, sockaddrLen);

        if (sockaddrArray !== null) {
            safeSockaddrLen = sockaddrLen;
        }
    } else {
        const known = findSockaddrForFd(fd, kind);
        sockaddrArray = known.sockaddrArray;
        safeSockaddrLen = known.sockaddrLen;
    }

    const template = {
        kind: kind,
        source: sourceName,
        fd: fd,

        packet: packet,
        packetLen: packet.length,

        nick: info.nick,
        lastMessage: info.msg,

        nickLen: info.nickLen,
        msgLen: info.msgLen,
        msgLenOffset: info.msgLenOffset,
        msgStart: info.msgStart,
        msgEnd: info.msgEnd,
        tailOffset: info.tailOffset,
        tailLen: info.tailLen,
        targetId: info.targetId,
        id1: info.id1,
        id2: info.id2,

        sockaddrArray: sockaddrArray,
        sockaddrLen: safeSockaddrLen,

        capturedAtMs: nowMs()
    };

    if (!state.chatTemplates) {
        state.chatTemplates = {};
    }

    state.chatTemplates[kind] = template;

    if (kind === "game" || !state.chatTemplate) {
        state.chatTemplate = template;
    }

    console.log(
        "[CHAT TEMPLATE] kind=" + kind +
        " source=" + sourceName +
        " fd=" + fd +
        " len=" + len +
        " nick=" + quote(info.nick) +
        " msg=" + quote(info.msg) +
        " targetId=" + (info.targetId === null || info.targetId === undefined ? "null" : info.targetId)
    );
}

// agent/src/injector.js
function normalizeChatKind(kind) {
    const value = String(kind || state.sendKind || "game").toLowerCase();

    if (CHAT_KINDS.indexOf(value) < 0) {
        throw new Error("unknown chat kind: " + kind);
    }

    return value;
}

function injectChat(text, nativeApi, kind, options) {
    const sendKind = normalizeChatKind(kind);

    const templates = state.chatTemplates || {};
    const template = templates[sendKind] || (sendKind === "game" ? state.chatTemplate : null);

    if (!template) {
        throw new Error("template for " + sendKind + " chat is not captured yet");
    }

    const currentMs = nowMs();
    const elapsed = currentMs - state.lastInjectAtMs;

    if (state.rateLimitMs > 0 && elapsed < state.rateLimitMs) {
        throw new Error("rate-limit: wait " + (state.rateLimitMs - elapsed) + " ms");
    }

    const built = buildChatMessage(template, text, state.maxLenBytes, options || {});
    const packet = built.packet;

    const packetPtr = arrayToMemory(packet);

    let via = "send";
    let r = -1;

    state.injecting = true;

    try {
        if (
            template.sockaddrArray &&
            template.sockaddrLen > 0
        ) {
            const sockaddrPtr = sockaddrArrayToMemory(template.sockaddrArray);

            via = "sendto";
            r = nativeApi.sendtoNative(
                template.fd,
                packetPtr,
                packet.length,
                0,
                sockaddrPtr,
                template.sockaddrLen
            );
        } else {
            via = "send";
            r = nativeApi.sendNative(
                template.fd,
                packetPtr,
                packet.length,
                0
            );
        }
    } catch (e) {
        state.injecting = false;
        console.log("[INJECT] error: " + e);
        throw e;
    }

    state.injecting = false;
    state.lastInjectAtMs = currentMs;

    console.log(
        "[INJECT] kind=" + sendKind +
        " text=" + quote(text) +
        " bytes=" + built.msgBytesLen +
        " packetLen=" + packet.length +
        " via=" + via +
        " r=" + r +
        " targetId=" + (built.targetId === null || built.targetId === undefined ? "null" : built.targetId)
    );

    return {
        ok: r === packet.length,
        kind: sendKind,
        result: r,
        via: via,
        bytes: built.msgBytesLen,
        packetLen: packet.length,
        targetId: built.targetId
    };
}

// agent/src/receiver.js
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

function isValidIncomingAccountId(accountId) {
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

function incomingKindForInfo(info) {
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

function handleIncomingPacket(sourceName, fd, buf, len) {
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

// agent/src/hooks.js
function handleChatPacket(sourceName, fd, buf, len, sockaddr, sockaddrLen) {
    if (state.injecting) return false;
    if (len <= 0 || len > MAX_PACKET_LEN) return false;

    const firstOpcode = buf.readU8() & 0xff;

    if (
        CHAT_KIND_BY_OPCODE[firstOpcode] &&
        saveTemplateAtOffset(sourceName, fd, buf, len, 0, sockaddr, sockaddrLen)
    ) {
        return true;
    }

    for (let offset = 1; offset < len; offset++) {
        const opcode = buf.add(offset).readU8() & 0xff;

        if (!CHAT_KIND_BY_OPCODE[opcode]) {
            continue;
        }

        if (saveTemplateAtOffset(sourceName, fd, buf, len, offset, sockaddr, sockaddrLen)) {
            return true;
        }
    }

    return false;
}

function saveTemplateAtOffset(sourceName, fd, buf, len, offset, sockaddr, sockaddrLen) {
    const info = parseChatFromPtr(buf.add(offset), len - offset, "send");

    if (!info) {
        return false;
    }

    saveTemplate(sourceName, fd, buf.add(offset), len - offset, info, sockaddr, sockaddrLen);
    return true;
}

function installHooks(nativeApi) {
    Interceptor.attach(nativeApi.sendtoPtr, {
        onEnter(args) {
            const fd = args[0].toInt32();
            const buf = args[1];
            const len = args[2].toInt32();
            const sockaddr = args[4];
            const sockaddrLen = args[5].toInt32();

            handleChatPacket("sendto", fd, buf, len, sockaddr, sockaddrLen);
        }
    });

    console.log("[+] sendto hooked");

    Interceptor.attach(nativeApi.sendPtr, {
        onEnter(args) {
            const fd = args[0].toInt32();
            const buf = args[1];
            const len = args[2].toInt32();

            handleChatPacket("send", fd, buf, len, null, 0);
        }
    });

    console.log("[+] send hooked");

    if (nativeApi.recvfromPtr) {
        Interceptor.attach(nativeApi.recvfromPtr, {
            onEnter(args) {
                this.fd = args[0].toInt32();
                this.buf = args[1];
            },

            onLeave(retval) {
                const len = retval.toInt32();

                if (len <= 0) return;

                handleIncomingPacket("recvfrom", this.fd, this.buf, len);
            }
        });

        console.log("[+] recvfrom hooked");
    } else {
        console.log("[!] recvfrom not hooked: pointer is null");
    }

    if (nativeApi.recvPtr) {
        Interceptor.attach(nativeApi.recvPtr, {
            onEnter(args) {
                this.fd = args[0].toInt32();
                this.buf = args[1];
            },

            onLeave(retval) {
                const len = retval.toInt32();

                if (len <= 0) return;

                handleIncomingPacket("recv", this.fd, this.buf, len);
            }
        });

        console.log("[+] recv hooked");
    } else {
        console.log("[!] recv not hooked: pointer is null");
    }
}

// agent/src/rpc.js
function templateStatus(template) {
    if (!template) return null;

    return {
        kind: template.kind,
        source: template.source,
        fd: template.fd,
        nick: template.nick,
        lastMessage: template.lastMessage,
        templateLen: template.packetLen,
        msgLenOffset: template.msgLenOffset,
        msgStart: template.msgStart,
        msgEnd: template.msgEnd,
        tailOffset: template.tailOffset,
        tailLen: template.tailLen,
        targetId: template.targetId,
        id1: template.id1,
        id2: template.id2,
        hasSockaddr: !!(
            template.sockaddrArray &&
            template.sockaddrLen > 0
        )
    };
}

function allTemplateStatuses() {
    const result = {};
    const templates = state.chatTemplates || {};

    for (let i = 0; i < CHAT_KINDS.length; i++) {
        const kind = CHAT_KINDS[i];
        result[kind] = templateStatus(templates[kind]);
    }

    return result;
}

function installRpc(nativeApi) {
    rpc.exports = {
        status() {
            const templates = allTemplateStatuses();
            const activeTemplate = templates[state.sendKind] || templateStatus(state.chatTemplate);

            return {
                templateCaptured: state.chatTemplate !== null,
                activeTemplateCaptured: activeTemplate !== null,
                sendKind: state.sendKind,
                fd: activeTemplate ? activeTemplate.fd : null,
                nick: activeTemplate ? activeTemplate.nick : null,
                lastMessage: activeTemplate ? activeTemplate.lastMessage : null,
                templateLen: activeTemplate ? activeTemplate.templateLen : null,
                templates: templates,
                recvEnabled: state.recvEnabled,
                incomingCount: state.incomingCount || 0,
                incomingCounts: state.incomingCounts || {},
                lastIncoming: state.lastIncoming,
                hasSockaddr: !!(activeTemplate && activeTemplate.hasSockaddr),
                maxLenBytes: state.maxLenBytes,
                rateLimitMs: state.rateLimitMs
            };
        },

        sendchat(text) {
            return injectChat(String(text), nativeApi, state.sendKind, {});
        },

        sendchatkind(kind, text, targetId, targetField) {
            const options = {};

            if (targetId !== null && targetId !== undefined && String(targetId) !== "") {
                options.targetId = targetId;
            }

            if (targetField !== null && targetField !== undefined && String(targetField) !== "") {
                options.targetField = String(targetField);
            }

            return injectChat(String(text), nativeApi, normalizeChatKind(kind), options);
        },

        setsendkind(kind) {
            state.sendKind = normalizeChatKind(kind);
            console.log("[CONFIG] sendKind=" + state.sendKind);
            return { ok: true, sendKind: state.sendKind };
        },

        setmaxlen(n) {
            const value = parseInt(n, 10);

            if (!isFinite(value) || value <= 0) {
                throw new Error("maxLenBytes must be positive integer");
            }

            if (value > HARD_MAX_MESSAGE_BYTES) {
                throw new Error(
                    "maxLenBytes too large: " +
                    value +
                    ", hardMax=" +
                    HARD_MAX_MESSAGE_BYTES
                );
            }

            state.maxLenBytes = value;
            console.log("[CONFIG] maxLenBytes=" + state.maxLenBytes);

            return {
                ok: true,
                maxLenBytes: state.maxLenBytes
            };
        },

        setratems(n) {
            const value = parseInt(n, 10);

            if (!isFinite(value) || value < 0) {
                throw new Error("rateLimitMs must be integer >= 0");
            }

            state.rateLimitMs = value;
            console.log("[CONFIG] rateLimitMs=" + state.rateLimitMs);

            return {
                ok: true,
                rateLimitMs: state.rateLimitMs
            };
        },

        setrecv(enabled) {
            state.recvEnabled = !!enabled;
            console.log("[CONFIG] recvEnabled=" + state.recvEnabled);
            return { ok: true, recvEnabled: state.recvEnabled };
        },

        clearrecv() {
            state.incomingCount = 0;
            state.incomingCounts = {};
            state.lastIncoming = null;
            state.incomingDedupe = {};
            console.log("[CONFIG] incoming chat state cleared");
            return { ok: true };
        },

        clear(kind) {
            if (kind !== null && kind !== undefined && String(kind).trim() !== "") {
                const chatKind = normalizeChatKind(kind);

                if (state.chatTemplates) {
                    delete state.chatTemplates[chatKind];
                }

                if (state.chatTemplate && state.chatTemplate.kind === chatKind) {
                    state.chatTemplate = null;
                }

                console.log("[CONFIG] template cleared kind=" + chatKind);
                return { ok: true, kind: chatKind };
            }

            state.chatTemplate = null;
            state.chatTemplates = {};
            state.lastInjectAtMs = 0;

            console.log("[CONFIG] all templates cleared");

            return {
                ok: true
            };
        }
    };
}

// agent/src/main.js
const nativeApi = createNativeApi();

installHooks(nativeApi);
installRpc(nativeApi);

console.log("[*] chat injector loaded");
console.log("[*] Send one real message per chat kind to capture templates: game/clan/private.");

})();
