import assert from "node:assert/strict";
import test from "node:test";

import { incomingKindForInfo } from "../../agent/src/receiver.js";

test("incomingKindForInfo treats accountId -1 as public game chat", () => {
    assert.equal(incomingKindForInfo({ kind: "clan", accountId: -1 }), "game");
    assert.equal(incomingKindForInfo({ kind: "private", playerId: -1 }), "game");
});

test("incomingKindForInfo keeps real non-server clan messages as clan", () => {
    assert.equal(incomingKindForInfo({ kind: "clan", accountId: 123456 }), "clan");
});
