import { HARD_MAX_MESSAGE_BYTES } from "./constants.js";
import { injectChat } from "./injector.js";
import { state } from "./state.js";

export function installRpc(nativeApi) {
    rpc.exports = {
        status() {
            return {
                templateCaptured: state.chatTemplate !== null,
                fd: state.chatTemplate ? state.chatTemplate.fd : null,
                nick: state.chatTemplate ? state.chatTemplate.nick : null,
                lastMessage: state.chatTemplate ? state.chatTemplate.lastMessage : null,
                templateLen: state.chatTemplate ? state.chatTemplate.packetLen : null,
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
