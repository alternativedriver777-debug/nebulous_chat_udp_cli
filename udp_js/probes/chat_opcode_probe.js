'use strict';

// Read-only Nebulous.io UDP chat opcode probe.
// Attach with:
//   frida -U -n Nebulous.io -l udp_js/probes/chat_opcode_probe.js

(function () {

// ---------------------------------------------------------------------------
// 1. config
// ---------------------------------------------------------------------------

const MAX_PACKET_LEN = 8192;
const MAX_DUMP = 512;
const MAX_STORED_HITS = 200;
const DEFAULT_MIN_SCORE = 80;

const PROBE_MARKERS = [
    "GPROBE_",
    "CPROBE_",
    "PPROBE_"
];

const OLD_OPCODE_HINTS = {
    game: 0x08,
    clan: 0x09,
    private: 0x24
};

const CURRENT_OPCODE_GUESSES = [
    0x89, // confirmed game chat
    0x8a, // possible clan
    0xa5  // possible private
];

const CURRENT_OPCODE_KIND = {
    0x89: "game",
    0x8a: "clan",
    0xa5: "private"
};

const OLD_OPCODE_KIND = {
    0x08: "old-game",
    0x09: "old-clan",
    0x24: "old-private"
};

const state = {
    minScore: DEFAULT_MIN_SCORE,
    verbose: false,
    markers: PROBE_MARKERS.slice(0)
};

const stats = {
    byOpcode: {},
    textHits: [],
    candidates: []
};

// ---------------------------------------------------------------------------
// 2. native exports
// ---------------------------------------------------------------------------

function findExport(name) {
    try {
        if (typeof Module.findGlobalExportByName === "function") {
            const p = Module.findGlobalExportByName(name);
            if (p && !p.isNull()) return p;
        }
    } catch (_) {}

    try {
        if (typeof Module.findExportByName === "function") {
            const p = Module.findExportByName(null, name);
            if (p && !p.isNull()) return p;
        }
    } catch (_) {}

    try {
        const libc = Process.getModuleByName("libc.so");
        if (libc && typeof libc.findExportByName === "function") {
            const p = libc.findExportByName(name);
            if (p && !p.isNull()) return p;
        }
    } catch (_) {}

    try {
        if (typeof Module.findExportByName === "function") {
            const p = Module.findExportByName("libc.so", name);
            if (p && !p.isNull()) return p;
        }
    } catch (_) {}

    return null;
}

function createNativeApi() {
    return {
        sendPtr: findExport("send"),
        sendtoPtr: findExport("sendto"),
        sendmsgPtr: findExport("sendmsg"),
        recvPtr: findExport("recv"),
        recvfromPtr: findExport("recvfrom"),
        recvmsgPtr: findExport("recvmsg")
    };
}

// ---------------------------------------------------------------------------
// 3. byte utils
// ---------------------------------------------------------------------------

function toNumber(v) {
    if (typeof v === "number") return v;
    if (v && typeof v.toNumber === "function") return v.toNumber();
    if (v && typeof v.toInt32 === "function") return v.toInt32();

    const s = String(v);
    if (s.indexOf("0x") === 0) return parseInt(s, 16);
    return parseInt(s, 10);
}

function readSizeT(p) {
    if (Process.pointerSize === 8) {
        return toNumber(p.readU64());
    }

    return p.readU32();
}

function safeReadU8(p, off) {
    return p.add(off).readU8() & 0xff;
}

function readU16BEFromArray(arr, off) {
    return ((arr[off] & 0xff) << 8) | (arr[off + 1] & 0xff);
}

function readU32BEFromArray(arr, off) {
    return (
        ((arr[off] & 0xff) << 24) |
        ((arr[off + 1] & 0xff) << 16) |
        ((arr[off + 2] & 0xff) << 8) |
        (arr[off + 3] & 0xff)
    ) >>> 0;
}

function ptrToArray(buf, len) {
    const n = Math.min(len, MAX_PACKET_LEN);
    const out = [];

    for (let i = 0; i < n; i++) {
        out.push(safeReadU8(buf, i));
    }

    return out;
}

function byteToHex(b) {
    return ("0" + (b & 0xff).toString(16)).slice(-2);
}

function opcodeHex(opcode) {
    return "0x" + byteToHex(opcode);
}

function u32HexBytes(v) {
    return [
        byteToHex((v >>> 24) & 0xff),
        byteToHex((v >>> 16) & 0xff),
        byteToHex((v >>> 8) & 0xff),
        byteToHex(v & 0xff)
    ].join(" ");
}

function bytesHex(arr, off, len) {
    const out = [];
    const start = off || 0;
    const end = Math.min(arr.length, start + len);

    for (let i = start; i < end; i++) {
        out.push(byteToHex(arr[i] & 0xff));
    }

    return out.join(" ");
}

function indexOfBytes(arr, needle, start) {
    if (!needle || needle.length === 0) return -1;

    const max = arr.length - needle.length;
    for (let i = start || 0; i <= max; i++) {
        let ok = true;

        for (let j = 0; j < needle.length; j++) {
            if ((arr[i + j] & 0xff) !== (needle[j] & 0xff)) {
                ok = false;
                break;
            }
        }

        if (ok) return i;
    }

    return -1;
}

function hexdumpArray(arr, maxBytes) {
    const limit = Math.min(arr.length, maxBytes || MAX_DUMP);
    const lines = [];

    for (let off = 0; off < limit; off += 16) {
        const hex = [];
        const ascii = [];

        for (let i = 0; i < 16; i++) {
            const idx = off + i;

            if (idx < limit) {
                const b = arr[idx] & 0xff;
                hex.push(byteToHex(b));
                ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
            } else {
                hex.push("  ");
                ascii.push(" ");
            }
        }

        lines.push(
            ("0000" + off.toString(16)).slice(-4) +
            "  " +
            hex.slice(0, 8).join(" ") +
            "  " +
            hex.slice(8).join(" ") +
            "  |" +
            ascii.join("") +
            "|"
        );
    }

    if (arr.length > limit) {
        lines.push("... truncated, len=" + arr.length + " maxDump=" + limit);
    }

    return lines.join("\n");
}

function boundedPush(list, item) {
    list.push(item);
    if (list.length > MAX_STORED_HITS) {
        list.shift();
    }
}

// ---------------------------------------------------------------------------
// 4. utf8/string utils
// ---------------------------------------------------------------------------

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
            out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
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

function utf8DecodeStrict(bytes) {
    let out = "";

    for (let i = 0; i < bytes.length;) {
        const b0 = bytes[i] & 0xff;

        if (b0 <= 0x7f) {
            out += String.fromCharCode(b0);
            i++;
            continue;
        }

        if ((b0 & 0xe0) === 0xc0) {
            if (i + 1 >= bytes.length) return { ok: false, text: out };

            const b1 = bytes[i + 1] & 0xff;
            if ((b1 & 0xc0) !== 0x80) return { ok: false, text: out };

            const cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
            if (cp < 0x80) return { ok: false, text: out };

            out += codePointToString(cp);
            i += 2;
            continue;
        }

        if ((b0 & 0xf0) === 0xe0) {
            if (i + 2 >= bytes.length) return { ok: false, text: out };

            const b1 = bytes[i + 1] & 0xff;
            const b2 = bytes[i + 2] & 0xff;
            if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) {
                return { ok: false, text: out };
            }

            const cp = ((b0 & 0x0f) << 12) |
                       ((b1 & 0x3f) << 6) |
                       (b2 & 0x3f);
            if (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff)) {
                return { ok: false, text: out };
            }

            out += codePointToString(cp);
            i += 3;
            continue;
        }

        if ((b0 & 0xf8) === 0xf0) {
            if (i + 3 >= bytes.length) return { ok: false, text: out };

            const b1 = bytes[i + 1] & 0xff;
            const b2 = bytes[i + 2] & 0xff;
            const b3 = bytes[i + 3] & 0xff;
            if (
                (b1 & 0xc0) !== 0x80 ||
                (b2 & 0xc0) !== 0x80 ||
                (b3 & 0xc0) !== 0x80
            ) {
                return { ok: false, text: out };
            }

            const cp = ((b0 & 0x07) << 18) |
                       ((b1 & 0x3f) << 12) |
                       ((b2 & 0x3f) << 6) |
                       (b3 & 0x3f);
            if (cp < 0x10000 || cp > 0x10ffff) {
                return { ok: false, text: out };
            }

            out += codePointToString(cp);
            i += 4;
            continue;
        }

        return { ok: false, text: out };
    }

    return { ok: true, text: out };
}

function quote(s) {
    try {
        return JSON.stringify(String(s));
    } catch (_) {
        return '"' + String(s) + '"';
    }
}

function containsProbeMarker(text) {
    const s = String(text);

    for (let i = 0; i < state.markers.length; i++) {
        if (s.indexOf(state.markers[i]) >= 0) return true;
    }

    return false;
}

function markerKind(markerText) {
    if (!markerText) return null;
    if (markerText.indexOf("GPROBE_") >= 0) return "game";
    if (markerText.indexOf("CPROBE_") >= 0) return "clan";
    if (markerText.indexOf("PPROBE_") >= 0) return "private";
    return null;
}

function isLikelyNick(text, byteLen) {
    const s = String(text);
    if (byteLen <= 0 || byteLen > 64) return false;
    if (s.length <= 0 || s.length > 32) return false;
    if (containsProbeMarker(s)) return false;

    let useful = 0;

    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);

        if (c < 0x20 || c === 0x7f) return false;
        if (/\s/.test(s.charAt(i))) continue;
        useful++;
    }

    return useful > 0;
}

function printableRunAt(arr, off) {
    let end = off;
    const maxEnd = Math.min(arr.length, off + 96);

    while (end < maxEnd) {
        const b = arr[end] & 0xff;
        if (b < 0x20 || b > 0x7e) break;
        end++;
    }

    const bytes = arr.slice(off, end);
    return utf8DecodeStrict(bytes).text;
}

function findProbeText(arr) {
    let best = null;

    for (let i = 0; i < state.markers.length; i++) {
        const prefix = state.markers[i];
        const needle = utf8Encode(prefix);
        const off = indexOfBytes(arr, needle, 0);

        if (off >= 0 && (!best || off < best.textOffset)) {
            best = {
                prefix: prefix,
                marker: printableRunAt(arr, off),
                textOffset: off
            };
        }
    }

    return best;
}

// ---------------------------------------------------------------------------
// 5. parsers
// ---------------------------------------------------------------------------

function tryParseTwoStringsPacket(arr) {
    try {
        if (!arr || arr.length < 9) return null;

        const opcode = arr[0] & 0xff;
        const u32Field = readU32BEFromArray(arr, 1);
        const str1LenOffset = 5;
        const str1Offset = 7;
        const str1Len = readU16BEFromArray(arr, str1LenOffset);

        if (str1Len > 1024) return null;

        const str1End = str1Offset + str1Len;
        if (str1End + 2 > arr.length) return null;

        const str2LenOffset = str1End;
        const str2Len = readU16BEFromArray(arr, str2LenOffset);
        const str2Offset = str2LenOffset + 2;

        if (str2Len > 4096) return null;

        const str2End = str2Offset + str2Len;
        if (str2End > arr.length) return null;

        const str1Bytes = arr.slice(str1Offset, str1End);
        const str2Bytes = arr.slice(str2Offset, str2End);
        const str1Decoded = utf8DecodeStrict(str1Bytes);
        const str2Decoded = utf8DecodeStrict(str2Bytes);

        if (!str1Decoded.ok || !str2Decoded.ok) {
            return {
                opcode: opcode,
                u32Field: u32Field,
                u32FieldHex: u32HexBytes(u32Field),
                str1Len: str1Len,
                str1: str1Decoded.text,
                str2Len: str2Len,
                str2: str2Decoded.text,
                str1Offset: str1Offset,
                str2Offset: str2Offset,
                tailOffset: str2End,
                tailLen: arr.length - str2End,
                tailHex: bytesHex(arr, str2End, 64),
                tailU32BE: str2End + 4 <= arr.length ? readU32BEFromArray(arr, str2End) : null,
                stringsValid: false,
                score: 0,
                kindGuess: null
            };
        }

        const parsed = {
            opcode: opcode,
            u32Field: u32Field,
            u32FieldHex: u32HexBytes(u32Field),
            str1Len: str1Len,
            str1: str1Decoded.text,
            str2Len: str2Len,
            str2: str2Decoded.text,
            str1Offset: str1Offset,
            str2Offset: str2Offset,
            tailOffset: str2End,
            tailLen: arr.length - str2End,
            tailHex: bytesHex(arr, str2End, 64),
            tailU32BE: str2End + 4 <= arr.length ? readU32BEFromArray(arr, str2End) : null,
            stringsValid: true,
            score: 0,
            kindGuess: null
        };

        scoreCandidate(parsed, findProbeText(arr));
        return parsed;
    } catch (e) {
        if (state.verbose) {
            console.log("[probe] tryParseTwoStringsPacket error: " + e);
        }

        return null;
    }
}

function readIovPayload(msg, wantedLen) {
    if (!msg || msg.isNull()) return null;

    const ps = Process.pointerSize;
    const iovOffset = ps === 8 ? 16 : 8;
    const iovLenOffset = ps === 8 ? 24 : 12;

    const iov = msg.add(iovOffset).readPointer();
    const iovLen = readSizeT(msg.add(iovLenOffset));

    if (!iov || iov.isNull() || iovLen <= 0 || iovLen > 64) return null;

    let remaining = Math.min(wantedLen || MAX_PACKET_LEN, MAX_PACKET_LEN);
    const out = [];
    const iovSize = ps * 2;

    for (let i = 0; i < iovLen && remaining > 0; i++) {
        const entry = iov.add(i * iovSize);
        const base = entry.readPointer();
        const len = readSizeT(entry.add(ps));

        if (!base || base.isNull() || len <= 0) continue;

        const take = Math.min(len, remaining);

        for (let j = 0; j < take; j++) {
            out.push(safeReadU8(base, j));
        }

        remaining -= take;
    }

    return out.length > 0 ? out : null;
}

function readSendmsgPayload(msg) {
    if (!msg || msg.isNull()) return null;

    const ps = Process.pointerSize;
    const iovOffset = ps === 8 ? 16 : 8;
    const iovLenOffset = ps === 8 ? 24 : 12;

    const iov = msg.add(iovOffset).readPointer();
    const iovLen = readSizeT(msg.add(iovLenOffset));

    if (!iov || iov.isNull() || iovLen <= 0 || iovLen > 64) return null;

    let total = 0;
    const iovSize = ps * 2;

    for (let i = 0; i < iovLen; i++) {
        const len = readSizeT(iov.add(i * iovSize + ps));
        if (len > 0) total += len;
        if (total >= MAX_PACKET_LEN) {
            total = MAX_PACKET_LEN;
            break;
        }
    }

    if (total <= 0) return null;
    return readIovPayload(msg, total);
}

// ---------------------------------------------------------------------------
// 6. scoring
// ---------------------------------------------------------------------------

function opcodeIsCandidate(opcode) {
    if (CURRENT_OPCODE_GUESSES.indexOf(opcode) >= 0) return true;

    for (const k in OLD_OPCODE_HINTS) {
        if (OLD_OPCODE_HINTS[k] === opcode) return true;
    }

    return false;
}

function guessKind(parsed, textHit) {
    if (textHit) {
        const byMarker = markerKind(textHit.marker || textHit.prefix);
        if (byMarker) return byMarker;
    }

    if (parsed.str1Len === 0 && parsed.str2 && parsed.str2.indexOf("CPROBE_") >= 0) {
        return "clan";
    }

    if (Object.prototype.hasOwnProperty.call(CURRENT_OPCODE_KIND, parsed.opcode)) {
        return CURRENT_OPCODE_KIND[parsed.opcode];
    }

    if (Object.prototype.hasOwnProperty.call(OLD_OPCODE_KIND, parsed.opcode)) {
        return OLD_OPCODE_KIND[parsed.opcode];
    }

    return "unknown";
}

function scoreCandidate(parsed, textHit) {
    let score = 0;

    if (parsed.stringsValid) score += 50;
    if (parsed.str2 && containsProbeMarker(parsed.str2)) score += 30;
    if (isLikelyNick(parsed.str1, parsed.str1Len)) score += 20;
    if (parsed.str1Len === 0 && parsed.str2 && parsed.str2.indexOf("CPROBE_") >= 0) score += 20;
    if (parsed.tailLen >= 0 && parsed.tailLen <= 128) score += 10;
    if (opcodeIsCandidate(parsed.opcode)) score += 10;

    parsed.score = score;
    parsed.kindGuess = guessKind(parsed, textHit);
    return score;
}

// ---------------------------------------------------------------------------
// 7. logging
// ---------------------------------------------------------------------------

function getOpcodeStats(opcode) {
    const key = opcodeHex(opcode);

    if (!stats.byOpcode[key]) {
        stats.byOpcode[key] = {
            send: 0,
            recv: 0,
            textHits: 0,
            candidates: 0
        };
    }

    return stats.byOpcode[key];
}

function notePayload(dir, opcode) {
    const entry = getOpcodeStats(opcode);

    if (dir === "SEND") {
        entry.send++;
    } else {
        entry.recv++;
    }
}

function noteTextHit(dir, source, fd, arr, textHit) {
    const opcode = arr.length > 0 ? arr[0] & 0xff : 0;
    const entry = getOpcodeStats(opcode);
    entry.textHits++;

    boundedPush(stats.textHits, {
        dir: dir,
        source: source,
        fd: fd,
        len: arr.length,
        opcode: opcodeHex(opcode),
        marker: textHit.marker,
        textOffset: textHit.textOffset,
        at: Date.now()
    });
}

function noteCandidate(dir, source, fd, len, parsed) {
    const entry = getOpcodeStats(parsed.opcode);
    entry.candidates++;

    boundedPush(stats.candidates, {
        dir: dir,
        source: source,
        fd: fd,
        len: len,
        opcode: opcodeHex(parsed.opcode),
        u32: parsed.u32FieldHex,
        str1Len: parsed.str1Len,
        str1: parsed.str1,
        str2Len: parsed.str2Len,
        str2: parsed.str2,
        tailOffset: parsed.tailOffset,
        tailLen: parsed.tailLen,
        tailHex: parsed.tailHex,
        tailU32BE: parsed.tailU32BE === null ? null : "0x" + ("00000000" + parsed.tailU32BE.toString(16)).slice(-8),
        score: parsed.score,
        kindGuess: parsed.kindGuess,
        at: Date.now()
    });
}

function formatCandidate(parsed) {
    if (!parsed) return "candidateParse=null";

    return [
        "opcode=" + opcodeHex(parsed.opcode),
        "u32=" + parsed.u32FieldHex,
        "str1Len=" + parsed.str1Len + " str1=" + quote(parsed.str1),
        "str2Len=" + parsed.str2Len + " str2=" + quote(parsed.str2),
        "str1Offset=" + parsed.str1Offset,
        "str2Offset=" + parsed.str2Offset,
        "tailOffset=" + parsed.tailOffset,
        "tailLen=" + parsed.tailLen,
        "tailHex=" + (parsed.tailHex || ""),
        "tailU32BE=" + (parsed.tailU32BE === null ? "null" : "0x" + ("00000000" + parsed.tailU32BE.toString(16)).slice(-8)),
        "score=" + parsed.score,
        "kindGuess=" + parsed.kindGuess,
        "stringsValid=" + parsed.stringsValid
    ].join("\n");
}

function logTextHit(dir, source, fd, arr, textHit, parsed) {
    console.log(
        "\n========== PROBE TEXT HIT ==========\n" +
        "dir=" + dir + "\n" +
        "source=" + source + "\n" +
        "fd=" + fd + "\n" +
        "len=" + arr.length + "\n" +
        "opcode=" + opcodeHex(arr[0] & 0xff) + "\n" +
        "marker=" + textHit.marker + "\n" +
        "textOffset=" + textHit.textOffset + "\n" +
        "\n-- candidate parse results --\n" +
        formatCandidate(parsed) + "\n" +
        "\n-- hex dump --\n" +
        hexdumpArray(arr, MAX_DUMP) + "\n" +
        "========== END PROBE TEXT HIT =========="
    );
}

function logCandidate(dir, source, fd, len, parsed) {
    console.log(
        "\n[CHAT-CANDIDATE]\n" +
        "dir=" + dir + "\n" +
        "source=" + source + "\n" +
        "fd=" + fd + "\n" +
        "len=" + len + "\n" +
        formatCandidate(parsed)
    );
}

function dumpStatsText() {
    const keys = Object.keys(stats.byOpcode).sort(function (a, b) {
        return parseInt(a, 16) - parseInt(b, 16);
    });

    const lines = [
        "Opcode stats:",
        "minScore=" + state.minScore + " verbose=" + state.verbose + " markers=" + state.markers.join(",")
    ];

    if (keys.length === 0) {
        lines.push("(empty)");
    }

    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const s = stats.byOpcode[key];
        lines.push(
            key +
            " send=" + s.send +
            " recv=" + s.recv +
            " textHits=" + s.textHits +
            " candidates=" + s.candidates
        );
    }

    lines.push("storedTextHits=" + stats.textHits.length + " storedCandidates=" + stats.candidates.length);
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 8. hook handlers
// ---------------------------------------------------------------------------

function handlePayload(dir, source, fd, arr) {
    try {
        if (!arr || arr.length <= 0 || arr.length > MAX_PACKET_LEN) return false;

        const opcode = arr[0] & 0xff;
        notePayload(dir, opcode);

        const textHit = findProbeText(arr);
        const parsed = tryParseTwoStringsPacket(arr);

        if (parsed) {
            scoreCandidate(parsed, textHit);
        }

        const isCandidate = parsed && parsed.score >= state.minScore;

        if (textHit) {
            noteTextHit(dir, source, fd, arr, textHit);

            if (isCandidate) {
                noteCandidate(dir, source, fd, arr.length, parsed);
            }

            logTextHit(dir, source, fd, arr, textHit, parsed);
            return true;
        }

        if (isCandidate) {
            noteCandidate(dir, source, fd, arr.length, parsed);
            logCandidate(dir, source, fd, arr.length, parsed);
            return true;
        }
    } catch (e) {
        if (state.verbose) {
            console.log("[probe] handlePayload error source=" + source + " fd=" + fd + ": " + e);
        }
    }

    return false;
}

function handlePtrPayload(dir, source, fd, buf, len) {
    if (!buf || buf.isNull()) return false;
    if (len <= 0 || len > MAX_PACKET_LEN) return false;

    try {
        return handlePayload(dir, source, fd, ptrToArray(buf, len));
    } catch (e) {
        if (state.verbose) {
            console.log("[probe] read payload error source=" + source + " fd=" + fd + ": " + e);
        }
    }

    return false;
}

function installHooks(nativeApi) {
    if (nativeApi.sendtoPtr) {
        Interceptor.attach(nativeApi.sendtoPtr, {
            onEnter(args) {
                handlePtrPayload(
                    "SEND",
                    "sendto",
                    args[0].toInt32(),
                    args[1],
                    toNumber(args[2])
                );
            }
        });
        console.log("[+] sendto hooked");
    } else {
        console.log("[!] sendto not found");
    }

    if (nativeApi.sendPtr) {
        Interceptor.attach(nativeApi.sendPtr, {
            onEnter(args) {
                handlePtrPayload(
                    "SEND",
                    "send",
                    args[0].toInt32(),
                    args[1],
                    toNumber(args[2])
                );
            }
        });
        console.log("[+] send hooked");
    } else {
        console.log("[!] send not found");
    }

    if (nativeApi.sendmsgPtr) {
        Interceptor.attach(nativeApi.sendmsgPtr, {
            onEnter(args) {
                const fd = args[0].toInt32();
                const arr = readSendmsgPayload(args[1]);
                if (arr) handlePayload("SEND", "sendmsg", fd, arr);
            }
        });
        console.log("[+] sendmsg hooked");
    } else {
        console.log("[!] sendmsg not found");
    }

    if (nativeApi.recvfromPtr) {
        Interceptor.attach(nativeApi.recvfromPtr, {
            onEnter(args) {
                this.fd = args[0].toInt32();
                this.buf = args[1];
            },

            onLeave(retval) {
                const len = retval.toInt32();
                if (len > 0) {
                    handlePtrPayload("RECV", "recvfrom", this.fd, this.buf, len);
                }
            }
        });
        console.log("[+] recvfrom hooked");
    } else {
        console.log("[!] recvfrom not found");
    }

    if (nativeApi.recvPtr) {
        Interceptor.attach(nativeApi.recvPtr, {
            onEnter(args) {
                this.fd = args[0].toInt32();
                this.buf = args[1];
            },

            onLeave(retval) {
                const len = retval.toInt32();
                if (len > 0) {
                    handlePtrPayload("RECV", "recv", this.fd, this.buf, len);
                }
            }
        });
        console.log("[+] recv hooked");
    } else {
        console.log("[!] recv not found");
    }

    if (nativeApi.recvmsgPtr) {
        Interceptor.attach(nativeApi.recvmsgPtr, {
            onEnter(args) {
                this.fd = args[0].toInt32();
                this.msg = args[1];
            },

            onLeave(retval) {
                const len = retval.toInt32();
                if (len <= 0 || len > MAX_PACKET_LEN) return;

                const arr = readIovPayload(this.msg, len);
                if (arr) handlePayload("RECV", "recvmsg", this.fd, arr);
            }
        });
        console.log("[+] recvmsg hooked");
    } else {
        console.log("[!] recvmsg not found");
    }
}

// ---------------------------------------------------------------------------
// 9. console commands
// ---------------------------------------------------------------------------

function status() {
    const result = {
        ok: true,
        minScore: state.minScore,
        verbose: state.verbose,
        markers: state.markers.slice(0),
        opcodeCount: Object.keys(stats.byOpcode).length,
        textHits: stats.textHits.length,
        candidates: stats.candidates.length,
        maxPacketLen: MAX_PACKET_LEN,
        maxDump: MAX_DUMP
    };

    console.log(JSON.stringify(result, null, 2));
    return result;
}

function dumpStats() {
    const text = dumpStatsText();
    console.log(text);
    return {
        ok: true,
        text: text,
        byOpcode: stats.byOpcode,
        textHits: stats.textHits,
        candidates: stats.candidates
    };
}

function clearStats() {
    stats.byOpcode = {};
    stats.textHits = [];
    stats.candidates = [];
    console.log("[CONFIG] stats cleared");
    return { ok: true };
}

function setMinScore(score) {
    const value = parseInt(score, 10);
    if (!isFinite(value) || value < 0) {
        throw new Error("min score must be an integer >= 0");
    }

    state.minScore = value;
    console.log("[CONFIG] minScore=" + state.minScore);
    return { ok: true, minScore: state.minScore };
}

function setVerbose(enabled) {
    state.verbose = !!enabled;
    console.log("[CONFIG] verbose=" + state.verbose);
    return { ok: true, verbose: state.verbose };
}

function watchText(marker) {
    const text = String(marker);
    if (text.length <= 0) {
        throw new Error("marker must not be empty");
    }

    if (state.markers.indexOf(text) < 0) {
        state.markers.push(text);
    }

    console.log("[CONFIG] watchText=" + quote(text));
    return { ok: true, markers: state.markers.slice(0) };
}

globalThis.status = status;
globalThis.dumpStats = dumpStats;
globalThis.clearStats = clearStats;
globalThis.setMinScore = setMinScore;
globalThis.setVerbose = setVerbose;
globalThis.watchText = watchText;

rpc.exports = {
    status: status,
    dumpstats: dumpStats,
    clearstats: clearStats,
    setminscore: setMinScore,
    setverbose: setVerbose,
    watchtext: watchText
};

const nativeApi = createNativeApi();
installHooks(nativeApi);

console.log("[*] Nebulous.io UDP chat opcode probe loaded (read-only)");
console.log("[*] Markers: " + state.markers.join(", "));
console.log("[*] Commands: status(), dumpStats(), clearStats(), setMinScore(n), setVerbose(bool), watchText(text)");

})();
