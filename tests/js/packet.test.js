import assert from "node:assert/strict";
import test from "node:test";

import { CHAT_OPCODE, CHAT_OPCODE_BY_KIND } from "../../agent/src/constants.js";
import { buildChatMessage, parseChatFromArray, writeI32BEToArray, writeU16BEToArray } from "../../agent/src/packet.js";
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

function makeTwoStringPacket(kind, nick, msg, tail = []) {
    const nickBytes = utf8Encode(nick);
    const msgBytes = utf8Encode(msg);
    const packet = [
        CHAT_OPCODE_BY_KIND[kind],
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

function makePrivatePacket(id1, id2, alias, msg) {
    return makePrivatePacketWithIds([id1, id2], alias, msg);
}

function makePrivatePacketWithIds(ids, alias, msg) {
    const aliasBytes = utf8Encode(alias);
    const msgBytes = utf8Encode(msg);
    const packet = [
        CHAT_OPCODE_BY_KIND.private,
        ...ids.flatMap(() => [0x00, 0x00, 0x00, 0x00]),
        0x00,
        0x00,
        ...aliasBytes,
        0x00,
        0x00,
        ...msgBytes
    ];

    for (let i = 0; i < ids.length; i++) {
        writeI32BEToArray(packet, 1 + (i * 4), ids[i]);
    }

    const aliasLenOffset = 1 + (ids.length * 4);
    writeU16BEToArray(packet, aliasLenOffset, aliasBytes.length);
    writeU16BEToArray(packet, aliasLenOffset + 2 + aliasBytes.length, msgBytes.length);

    return packet;
}

test("parseChatFromArray reads nickname, message, and tail", () => {
    const packet = makePacket("nick", "hello", [0xaa, 0xbb]);
    const info = parseChatFromArray(packet);

    assert.equal(info.publicId, 0x01020304);
    assert.equal(info.accountId, null);
    assert.equal(info.nick, "nick");
    assert.equal(info.msg, "hello");
    assert.equal(info.tailLen, 2);
});

test("parseChatFromArray reads signed account id after message", () => {
    const packet = makePacket("nick", "hello", [0x00, 0x01, 0xe2, 0x40, 0x01]);
    const info = parseChatFromArray(packet);

    assert.equal(info.accountId, 123456);
    assert.equal(info.accountIdOffset, info.msgEnd);
});

test("parseChatFromArray preserves negative account id marker", () => {
    const packet = makePacket("nick", "hello", [0xff, 0xff, 0xff, 0xff, 0x00]);
    const info = parseChatFromArray(packet);

    assert.equal(info.accountId, -1);
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

test("parseChatFromArray reads clan role and account id", () => {
    const packet = makeTwoStringPacket("clan", "nick", "hello", [
        0x02,
        0x00,
        0x01,
        0xe2,
        0x40,
        0x00
    ]);
    const info = parseChatFromArray(packet);

    assert.equal(info.kind, "clan");
    assert.equal(info.clanRole, 2);
    assert.equal(info.accountId, 123456);
    assert.equal(info.nick, "nick");
    assert.equal(info.msg, "hello");
});

test("buildChatMessage rewrites clan message and keeps tail", () => {
    const template = { packet: makeTwoStringPacket("clan", "", "hello", [0x00, 0xff]) };
    const built = buildChatMessage(template, "clan hi", 128);
    const info = parseChatFromArray(built.packet);

    assert.equal(info.kind, "clan");
    assert.equal(info.nick, "");
    assert.equal(info.msg, "clan hi");
    assert.deepEqual(built.packet.slice(-2), [0x00, 0xff]);
});

test("parseChatFromArray reads private ids, alias, and message", () => {
    const packet = makePrivatePacket(111, 222, "nick", "secret");
    const info = parseChatFromArray(packet);

    assert.equal(info.kind, "private");
    assert.equal(info.id1, 111);
    assert.equal(info.id2, 222);
    assert.equal(info.targetId, 222);
    assert.equal(info.nick, "nick");
    assert.equal(info.msg, "secret");
});

test("buildChatMessage rewrites private message and target id", () => {
    const template = { packet: makePrivatePacket(111, 222, "", "old") };
    const built = buildChatMessage(template, "new", 128, { targetId: 333 });
    const info = parseChatFromArray(built.packet);

    assert.equal(info.kind, "private");
    assert.equal(info.id1, 111);
    assert.equal(info.id2, 333);
    assert.equal(info.nick, "");
    assert.equal(info.msg, "new");
});

test("parseChatFromArray accepts private packets with one or three id fields", () => {
    const oneIdInfo = parseChatFromArray(makePrivatePacketWithIds([222], "", "one"));
    const threeIdInfo = parseChatFromArray(makePrivatePacketWithIds([111, 222, 333], "", "three"));

    assert.equal(oneIdInfo.kind, "private");
    assert.equal(oneIdInfo.id1, 222);
    assert.equal(oneIdInfo.msg, "one");
    assert.equal(threeIdInfo.kind, "private");
    assert.equal(threeIdInfo.id1, 111);
    assert.equal(threeIdInfo.id2, 222);
    assert.equal(threeIdInfo.msg, "three");
});
