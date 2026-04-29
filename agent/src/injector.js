import { arrayToMemory, sockaddrArrayToMemory } from "./memory.js";
import { buildChatMessage } from "./packet.js";
import { state } from "./state.js";
import { nowMs, quote } from "./utils.js";

export function injectChat(text, nativeApi) {
    if (!state.chatTemplate) {
        throw new Error("template is not captured yet");
    }

    const currentMs = nowMs();
    const elapsed = currentMs - state.lastInjectAtMs;

    if (state.rateLimitMs > 0 && elapsed < state.rateLimitMs) {
        throw new Error("rate-limit: wait " + (state.rateLimitMs - elapsed) + " ms");
    }

    const built = buildChatMessage(state.chatTemplate, text, state.maxLenBytes);
    const packet = built.packet;

    const packetPtr = arrayToMemory(packet);

    let via = "send";
    let r = -1;

    state.injecting = true;

    try {
        if (
            state.chatTemplate.sockaddrArray &&
            state.chatTemplate.sockaddrLen > 0
        ) {
            const sockaddrPtr = sockaddrArrayToMemory(state.chatTemplate.sockaddrArray);

            via = "sendto";
            r = nativeApi.sendtoNative(
                state.chatTemplate.fd,
                packetPtr,
                packet.length,
                0,
                sockaddrPtr,
                state.chatTemplate.sockaddrLen
            );
        } else {
            via = "send";
            r = nativeApi.sendNative(
                state.chatTemplate.fd,
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
        "[INJECT] text=" + quote(text) +
        " bytes=" + built.msgBytesLen +
        " packetLen=" + packet.length +
        " via=" + via +
        " r=" + r
    );

    return {
        ok: r === packet.length,
        result: r,
        via: via,
        bytes: built.msgBytesLen,
        packetLen: packet.length
    };
}
