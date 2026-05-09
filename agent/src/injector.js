import { CHAT_KINDS } from "./constants.js";
import { arrayToMemory, sockaddrArrayToMemory } from "./memory.js";
import { buildChatMessage } from "./packet.js";
import { state } from "./state.js";
import { nowMs, quote } from "./utils.js";

export function normalizeChatKind(kind) {
    const value = String(kind || state.sendKind || "game").toLowerCase();

    if (CHAT_KINDS.indexOf(value) < 0) {
        throw new Error("unknown chat kind: " + kind);
    }

    return value;
}

export function injectChat(text, nativeApi, kind, options) {
    const sendKind = normalizeChatKind(kind);

    const templates = state.chatTemplates || {};
    const template = templates[sendKind] || (sendKind === "game" ? state.chatTemplate : null);

    if (!template) {
        throw new Error("template for " + sendKind + " chat is not captured yet");
    }

    const currentMs = nowMs();
    const elapsed = currentMs - state.lastInjectAtMs;

    if (state.rateLimitMs > 0 && elapsed < state.rateLimitMs) {
        throw new Error("rate-limit: wait " + (state.rateLimitMs - elapsed) + " ms");
    }

    const built = buildChatMessage(template, text, state.maxLenBytes, options || {});
    const packet = built.packet;

    const packetPtr = arrayToMemory(packet);

    let via = "send";
    let r = -1;

    state.injecting = true;

    try {
        if (
            template.sockaddrArray &&
            template.sockaddrLen > 0
        ) {
            const sockaddrPtr = sockaddrArrayToMemory(template.sockaddrArray);

            via = "sendto";
            r = nativeApi.sendtoNative(
                template.fd,
                packetPtr,
                packet.length,
                0,
                sockaddrPtr,
                template.sockaddrLen
            );
        } else {
            via = "send";
            r = nativeApi.sendNative(
                template.fd,
                packetPtr,
                packet.length,
                0
            );
        }
    } catch (e) {
        state.injecting = false;
        console.log("[INJECT] error: " + e);
        throw e;
    }

    state.injecting = false;
    state.lastInjectAtMs = currentMs;

    console.log(
        "[INJECT] kind=" + sendKind +
        " text=" + quote(text) +
        " bytes=" + built.msgBytesLen +
        " packetLen=" + packet.length +
        " via=" + via +
        " r=" + r +
        " targetId=" + (built.targetId === null || built.targetId === undefined ? "null" : built.targetId)
    );

    return {
        ok: r === packet.length,
        kind: sendKind,
        result: r,
        via: via,
        bytes: built.msgBytesLen,
        packetLen: packet.length,
        targetId: built.targetId
    };
}
