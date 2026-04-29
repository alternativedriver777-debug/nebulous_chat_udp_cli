import assert from "node:assert/strict";
import test from "node:test";

import { CHAT_OPCODE } from "../../agent/src/constants.js";
import { buildChatMessage, parseChatFromArray, writeU16BEToArray } from "../../agent/src/packet.js";
import { utf8Encode } from "../../agent/src/utf8.js";

function makePacket(nick, msg, tail = [0xff, 0x00]) {
    const nickBytes = utf8Encode(nick);
    const msgBytes = utf8Encode(msg);
    const packet = [
        CHAT_OPCODE,
        0x01,
        0x02,
        0x03,
        0x04,
        0x00,
        0x00,
        ...nickBytes,
        0x00,
        0x00,
        ...msgBytes,
        ...tail
    ];

    writeU16BEToArray(packet, 5, nickBytes.length);
    writeU16BEToArray(packet, 7 + nickBytes.length, msgBytes.length);

    return packet;
}

test("parseChatFromArray reads nickname, message, and tail", () => {
    const packet = makePacket("nick", "hello", [0xaa, 0xbb]);
    const info = parseChatFromArray(packet);

    assert.equal(info.nick, "nick");
    assert.equal(info.msg, "hello");
    assert.equal(info.tailLen, 2);
});

test("buildChatMessage replaces message and preserves tail", () => {
    const template = { packet: makePacket("nick", "hello", [0xaa, 0xbb]) };
    const built = buildChatMessage(template, "yo", 128);
    const info = parseChatFromArray(built.packet);

    assert.equal(info.nick, "nick");
    assert.equal(info.msg, "yo");
    assert.deepEqual(built.packet.slice(-2), [0xaa, 0xbb]);
});

test("buildChatMessage rejects empty messages", () => {
    const template = { packet: makePacket("nick", "hello") };

    assert.throws(() => buildChatMessage(template, "", 128), /empty message/);
});

test("buildChatMessage rejects long messages", () => {
    const template = { packet: makePacket("nick", "hello") };

    assert.throws(() => buildChatMessage(template, "hello", 2), /message too long/);
});

test("buildChatMessage rejects invalid templates", () => {
    const template = { packet: [0x00, 0x01] };

    assert.throws(() => buildChatMessage(template, "hello", 128), /cannot parse saved template/);
});
