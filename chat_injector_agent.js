'use strict';



const CHAT_OPCODE = 0x89;
const MAX_PACKET_LEN = 8192;
const HARD_MAX_MESSAGE_BYTES = 4096;

let maxLenBytes = 128;
let rateLimitMs = 1000;

let injecting = false;
let lastInjectAtMs = 0;

let chatTemplate = null;

function log(s) {
    console.log(s);
}

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

const sendPtr = findExport("send");
const sendtoPtr = findExport("sendto");

if (!sendPtr || !sendtoPtr) {
    throw new Error("send/sendto not found");
}

const sendNative = new NativeFunction(sendPtr, "int", [
    "int",
    "pointer",
    "int",
    "int"
]);

const sendtoNative = new NativeFunction(sendtoPtr, "int", [
    "int",
    "pointer",
    "int",
    "int",
    "pointer",
    "int"
]);

function readU16BEFromPtr(p) {
    const a = p.readU8();
    const b = p.add(1).readU8();
    return (a << 8) | b;
}

function readU16BEFromArray(arr, off) {
    return ((arr[off] & 0xff) << 8) | (arr[off + 1] & 0xff);
}

function writeU16BEToArray(arr, off, v) {
    arr[off] = (v >> 8) & 0xff;
    arr[off + 1] = v & 0xff;
}

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
            console.log("[CHAT] invalid nickLen=" + nickLen + " len=" + len);
            return null;
        }

        if (nickEnd + 2 > len) {
            console.log("[CHAT] nickLen out of bounds=" + nickLen + " len=" + len);
            return null;
        }

        const msgLenOffset = nickEnd;
        const msgLen = readU16BEFromPtr(buf.add(msgLenOffset));
        const msgStart = msgLenOffset + 2;
        const msgEnd = msgStart + msgLen;

        if (msgLen < 0 || msgLen > 4096) {
            console.log("[CHAT] invalid msgLen=" + msgLen + " len=" + len);
            return null;
        }

        if (msgEnd > len) {
            console.log("[CHAT] msgLen out of bounds=" + msgLen + " len=" + len);
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
            tailLen: len - msgEnd,

            nick: utf8Decode(nickBytes),
            msg: utf8Decode(msgBytes)
        };

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
        tailLen: arr.length - msgEnd,

        nick: utf8Decode(nickBytes),
        msg: utf8Decode(msgBytes)
    };
}

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
        chatTemplate &&
        chatTemplate.fd === fd &&
        chatTemplate.sockaddrArray &&
        chatTemplate.sockaddrLen > 0
    ) {
        sockaddrArray = chatTemplate.sockaddrArray.slice(0);
        safeSockaddrLen = chatTemplate.sockaddrLen;
    }

    chatTemplate = {
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

function buildChatMessage(template, newText) {
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

function injectChat(text) {
    if (!chatTemplate) {
        throw new Error("template is not captured yet");
    }

    const currentMs = nowMs();
    const elapsed = currentMs - lastInjectAtMs;

    if (rateLimitMs > 0 && elapsed < rateLimitMs) {
        throw new Error("rate-limit: wait " + (rateLimitMs - elapsed) + " ms");
    }

    const built = buildChatMessage(chatTemplate, text);
    const packet = built.packet;

    const packetPtr = arrayToMemory(packet);

    let via = "send";
    let r = -1;

    injecting = true;

    try {
        if (
            chatTemplate.sockaddrArray &&
            chatTemplate.sockaddrLen > 0
        ) {
            const sockaddrPtr = sockaddrArrayToMemory(chatTemplate.sockaddrArray);

            via = "sendto";
            r = sendtoNative(
                chatTemplate.fd,
                packetPtr,
                packet.length,
                0,
                sockaddrPtr,
                chatTemplate.sockaddrLen
            );
        } else {
            via = "send";
            r = sendNative(
                chatTemplate.fd,
                packetPtr,
                packet.length,
                0
            );
        }
    } catch (e) {
        injecting = false;
        console.log("[INJECT] error: " + e);
        throw e;
    }

    injecting = false;
    lastInjectAtMs = currentMs;

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

function handleChatPacket(sourceName, fd, buf, len, sockaddr, sockaddrLen) {
    if (injecting) return false;
    if (len <= 0 || len > MAX_PACKET_LEN) return false;

    const info = parseChatFromPtr(buf, len);

    if (!info) {
        return false;
    }

    saveTemplate(sourceName, fd, buf, len, info, sockaddr, sockaddrLen);
    return true;
}

Interceptor.attach(sendtoPtr, {
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

Interceptor.attach(sendPtr, {
    onEnter(args) {
        const fd = args[0].toInt32();
        const buf = args[1];
        const len = args[2].toInt32();

        handleChatPacket("send", fd, buf, len, null, 0);
    }
});

console.log("[+] send hooked");

rpc.exports = {
    status() {
        return {
            templateCaptured: chatTemplate !== null,
            fd: chatTemplate ? chatTemplate.fd : null,
            nick: chatTemplate ? chatTemplate.nick : null,
            lastMessage: chatTemplate ? chatTemplate.lastMessage : null,
            templateLen: chatTemplate ? chatTemplate.packetLen : null,
            hasSockaddr: !!(
                chatTemplate &&
                chatTemplate.sockaddrArray &&
                chatTemplate.sockaddrLen > 0
            ),
            maxLenBytes: maxLenBytes,
            rateLimitMs: rateLimitMs
        };
    },

    sendchat(text) {
        return injectChat(String(text));
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

        maxLenBytes = value;
        console.log("[CONFIG] maxLenBytes=" + maxLenBytes);

        return {
            ok: true,
            maxLenBytes: maxLenBytes
        };
    },

    setratems(n) {
        const value = parseInt(n, 10);

        if (!isFinite(value) || value < 0) {
            throw new Error("rateLimitMs must be integer >= 0");
        }

        rateLimitMs = value;
        console.log("[CONFIG] rateLimitMs=" + rateLimitMs);

        return {
            ok: true,
            rateLimitMs: rateLimitMs
        };
    },

    clear() {
        chatTemplate = null;
        lastInjectAtMs = 0;

        console.log("[CONFIG] template cleared");

        return {
            ok: true
        };
    }
};

console.log("[*] chat injector loaded");
console.log("[*] Send any message in real Nebulous.io chat to capture template.");