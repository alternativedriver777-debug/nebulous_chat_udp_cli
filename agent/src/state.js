import { DEFAULT_MAX_LEN_BYTES, DEFAULT_RATE_LIMIT_MS } from "./constants.js";

export const state = {
    maxLenBytes: DEFAULT_MAX_LEN_BYTES,
    rateLimitMs: DEFAULT_RATE_LIMIT_MS,
    injecting: false,
    lastInjectAtMs: 0,
    chatTemplate: null
};
