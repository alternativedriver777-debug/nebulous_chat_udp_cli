import assert from "node:assert/strict";
import test from "node:test";

import { utf8Decode, utf8Encode } from "../../agent/src/utf8.js";

test("utf8 round-trips ascii", () => {
    const text = "hello";

    assert.deepEqual(utf8Encode(text), [104, 101, 108, 108, 111]);
    assert.equal(utf8Decode(utf8Encode(text)), text);
});

test("utf8 round-trips cyrillic", () => {
    const text = "привет";

    assert.equal(utf8Decode(utf8Encode(text)), text);
});

test("utf8 round-trips emoji", () => {
    const text = "hi 😀";

    assert.equal(utf8Decode(utf8Encode(text)), text);
});
