import assert from "node:assert/strict";
import test from "node:test";

import { incomingKindForInfo, isValidIncomingAccountId } from "../../agent/src/receiver.js";

test("incomingKindForInfo treats accountId -1 as public game chat", () => {
    assert.equal(incomingKindForInfo({ kind: "clan", accountId: -1 }), "game");
    assert.equal(incomingKindForInfo({ kind: "private", playerId: -1 }), "game");
});

test("incomingKindForInfo keeps real non-server clan messages as clan", () => {
    assert.equal(incomingKindForInfo({ kind: "clan", accountId: 123456 }), "clan");
});

test("isValidIncomingAccountId rejects impossible account ids", () => {
    assert.equal(isValidIncomingAccountId(-1), true);
    assert.equal(isValidIncomingAccountId(0), true);
    assert.equal(isValidIncomingAccountId(199999999), true);
    assert.equal(isValidIncomingAccountId(-2), false);
    assert.equal(isValidIncomingAccountId(200000000), false);
    assert.equal(isValidIncomingAccountId(1493173843), false);
    assert.equal(isValidIncomingAccountId(-637531807), false);
});
