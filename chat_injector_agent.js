'use strict';

// Generated from agent/src/*.js. Run `npm run build:agent` when Node/npm is available.
(function () {

// agent/src/constants.js
const CHAT_OPCODE = 0x89;
const MAX_PACKET_LEN = 8192;
const HARD_MAX_MESSAGE_BYTES = 4096;
const DEFAULT_MAX_LEN_BYTES = 128;
const DEFAULT_RATE_LIMIT_MS = 1000;

// agent/src/state.js

const state = {
    maxLenBytes: DEFAULT_MAX_LEN_BYTES,
    rateLimitMs: DEFAULT_RATE_LIMIT_MS,
    injecting: false,
    lastInjectAtMs: 0,
    chatTemplate: null,
    recvEnabled: true,
    incomingCount: 0,
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

function parseChatFromPtr(buf, len) {
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

        const publicId = readU32BEFromPtr(buf.add(1));
        let accountId = null;

        if (msgEnd + 4 <= len) {
            accountId = readI32BEFromPtr(buf.add(msgEnd));
        }

        return makeChatInfo(len, publicId, accountId, nickLenOffset, nickStart, nickLen, msgLenOffset, msgStart, msgLen, nickBytes, msgBytes);

    } catch (e) {
        console.log("[CHAT] parseChatFromPtr error: " + e);
        return null;
    }
}

function parseChatFromArray(arr) {
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

    const publicId = readU32BEFromArray(arr, 1);
    const accountId = msgEnd + 4 <= arr.length ? readI32BEFromArray(arr, msgEnd) : null;

    return makeChatInfo(arr.length, publicId, accountId, nickLenOffset, nickStart, nickLen, msgLenOffset, msgStart, msgLen, nickBytes, msgBytes);
}

function makeChatInfo(packetLen, publicId, accountId, nickLenOffset, nickStart, nickLen, msgLenOffset, msgStart, msgLen, nickBytes, msgBytes) {
    const nickEnd = nickStart + nickLen;
    const msgEnd = msgStart + msgLen;

    return {
        publicId: publicId,
        accountId: accountId,
        accountIdOffset: msgEnd,

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

function buildChatMessage(template, newText, maxLenBytes) {
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

function saveTemplate(sourceName, fd, buf, len, info, sockaddr, sockaddrLen) {
    const packet = ptrToArray(buf, len);

    let sockaddrArray = null;
    let safeSockaddrLen = 0;

    if (sourceName === "sendto" && sockaddr && !sockaddr.isNull() && sockaddrLen > 0) {
        sockaddrArray = copySockaddrToArray(sockaddr, sockaddrLen);

        if (sockaddrArray !== null) {
            safeSockaddrLen = sockaddrLen;
        }
    } else if (
        state.chatTemplate &&
        state.chatTemplate.fd === fd &&
        state.chatTemplate.sockaddrArray &&
        state.chatTemplate.sockaddrLen > 0
    ) {
        sockaddrArray = state.chatTemplate.sockaddrArray.slice(0);
        safeSockaddrLen = state.chatTemplate.sockaddrLen;
    }

    state.chatTemplate = {
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

        sockaddrArray: sockaddrArray,
        sockaddrLen: safeSockaddrLen,

        capturedAtMs: nowMs()
    };

    console.log(
        "[CHAT TEMPLATE] source=" + sourceName +
        " fd=" + fd +
        " len=" + len +
        " nick=" + quote(info.nick) +
        " msg=" + quote(info.msg)
    );
}

// agent/src/injector.js

function injectChat(text, nativeApi) {
    if (!state.chatTemplate) {
        throw new Error("template is not captured yet");
    }

    const currentMs = nowMs();
    const elapsed = currentMs - state.lastInjectAtMs;

    if (state.rateLimitMs > 0 && elapsed < state.rateLimitMs) {
        throw new Error("rate-limit: wait " + (state.rateLimitMs - elapsed) + " ms");
    }

    const built = buildChatMessage(state.chatTemplate, text, state.maxLenBytes);
    const packet = built.packet;

    const packetPtr = arrayToMemory(packet);

    let via = "send";
    let r = -1;

    state.injecting = true;

    try {
        if (
            state.chatTemplate.sockaddrArray &&
            state.chatTemplate.sockaddrLen > 0
        ) {
            const sockaddrPtr = sockaddrArrayToMemory(state.chatTemplate.sockaddrArray);

            via = "sendto";
            r = nativeApi.sendtoNative(
                state.chatTemplate.fd,
                packetPtr,
                packet.length,
                0,
                sockaddrPtr,
                state.chatTemplate.sockaddrLen
            );
        } else {
            via = "send";
            r = nativeApi.sendNative(
                state.chatTemplate.fd,
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
        "[INJECT] text=" + quote(text) +
        " bytes=" + built.msgBytesLen +
        " packetLen=" + packet.length +
        " via=" + via +
        " r=" + r
    );

    return {
        ok: r === packet.length,
        result: r,
        via: via,
        bytes: built.msgBytesLen,
        packetLen: packet.length
    };
}

// agent/src/receiver.js

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

function isDuplicateIncoming(key) {
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

    if (isDuplicateIncoming(dedupeKey)) {
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

function handleIncomingPacket(sourceName, fd, buf, len) {
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

// agent/src/hooks.js

function handleChatPacket(sourceName, fd, buf, len, sockaddr, sockaddrLen) {
    if (state.injecting) return false;
    if (len <= 0 || len > MAX_PACKET_LEN) return false;

    const info = parseChatFromPtr(buf, len);

    if (!info) {
        return false;
    }

    saveTemplate(sourceName, fd, buf, len, info, sockaddr, sockaddrLen);
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

function installRpc(nativeApi) {
    rpc.exports = {
        status() {
            return {
                templateCaptured: state.chatTemplate !== null,
                fd: state.chatTemplate ? state.chatTemplate.fd : null,
                nick: state.chatTemplate ? state.chatTemplate.nick : null,
                lastMessage: state.chatTemplate ? state.chatTemplate.lastMessage : null,
                templateLen: state.chatTemplate ? state.chatTemplate.packetLen : null,
                recvEnabled: state.recvEnabled,
                incomingCount: state.incomingCount || 0,
                lastIncoming: state.lastIncoming,
                hasSockaddr: !!(
                    state.chatTemplate &&
                    state.chatTemplate.sockaddrArray &&
                    state.chatTemplate.sockaddrLen > 0
                ),
                maxLenBytes: state.maxLenBytes,
                rateLimitMs: state.rateLimitMs
            };
        },

        sendchat(text) {
            return injectChat(String(text), nativeApi);
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
            state.lastIncoming = null;
            state.incomingDedupe = {};
            console.log("[CONFIG] incoming chat state cleared");
            return { ok: true };
        },

        clear() {
            state.chatTemplate = null;
            state.lastInjectAtMs = 0;

            console.log("[CONFIG] template cleared");

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
console.log("[*] Send any message in real Nebulous.io chat to capture template.");

})();
