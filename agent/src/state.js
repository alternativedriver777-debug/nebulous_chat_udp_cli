import { DEFAULT_MAX_LEN_BYTES, DEFAULT_RATE_LIMIT_MS, DEFAULT_SEND_KIND } from "./constants.js";

export const state = {
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
