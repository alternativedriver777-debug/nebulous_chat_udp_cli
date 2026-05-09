import { CHAT_KINDS, HARD_MAX_MESSAGE_BYTES } from "./constants.js";
import { injectChat, normalizeChatKind } from "./injector.js";
import { state } from "./state.js";

function templateStatus(template) {
    if (!template) return null;

    return {
        kind: template.kind,
        source: template.source,
        fd: template.fd,
        nick: template.nick,
        lastMessage: template.lastMessage,
        templateLen: template.packetLen,
        msgLenOffset: template.msgLenOffset,
        msgStart: template.msgStart,
        msgEnd: template.msgEnd,
        tailOffset: template.tailOffset,
        tailLen: template.tailLen,
        targetId: template.targetId,
        id1: template.id1,
        id2: template.id2,
        hasSockaddr: !!(
            template.sockaddrArray &&
            template.sockaddrLen > 0
        )
    };
}

function allTemplateStatuses() {
    const result = {};
    const templates = state.chatTemplates || {};

    for (let i = 0; i < CHAT_KINDS.length; i++) {
        const kind = CHAT_KINDS[i];
        result[kind] = templateStatus(templates[kind]);
    }

    return result;
}

export function installRpc(nativeApi) {
    rpc.exports = {
        status() {
            const templates = allTemplateStatuses();
            const activeTemplate = templates[state.sendKind] || templateStatus(state.chatTemplate);

            return {
                templateCaptured: state.chatTemplate !== null,
                activeTemplateCaptured: activeTemplate !== null,
                sendKind: state.sendKind,
                fd: activeTemplate ? activeTemplate.fd : null,
                nick: activeTemplate ? activeTemplate.nick : null,
                lastMessage: activeTemplate ? activeTemplate.lastMessage : null,
                templateLen: activeTemplate ? activeTemplate.templateLen : null,
                templates: templates,
                recvEnabled: state.recvEnabled,
                incomingCount: state.incomingCount || 0,
                incomingCounts: state.incomingCounts || {},
                lastIncoming: state.lastIncoming,
                hasSockaddr: !!(activeTemplate && activeTemplate.hasSockaddr),
                maxLenBytes: state.maxLenBytes,
                rateLimitMs: state.rateLimitMs
            };
        },

        sendchat(text) {
            return injectChat(String(text), nativeApi, state.sendKind, {});
        },

        sendchatkind(kind, text, targetId, targetField) {
            const options = {};

            if (targetId !== null && targetId !== undefined && String(targetId) !== "") {
                options.targetId = targetId;
            }

            if (targetField !== null && targetField !== undefined && String(targetField) !== "") {
                options.targetField = String(targetField);
            }

            return injectChat(String(text), nativeApi, normalizeChatKind(kind), options);
        },

        setsendkind(kind) {
            state.sendKind = normalizeChatKind(kind);
            console.log("[CONFIG] sendKind=" + state.sendKind);
            return { ok: true, sendKind: state.sendKind };
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

        setrecv(enabled) {
            state.recvEnabled = !!enabled;
            console.log("[CONFIG] recvEnabled=" + state.recvEnabled);
            return { ok: true, recvEnabled: state.recvEnabled };
        },

        clearrecv() {
            state.incomingCount = 0;
            state.incomingCounts = {};
            state.lastIncoming = null;
            state.incomingDedupe = {};
            console.log("[CONFIG] incoming chat state cleared");
            return { ok: true };
        },

        clear(kind) {
            if (kind !== null && kind !== undefined && String(kind).trim() !== "") {
                const chatKind = normalizeChatKind(kind);

                if (state.chatTemplates) {
                    delete state.chatTemplates[chatKind];
                }

                if (state.chatTemplate && state.chatTemplate.kind === chatKind) {
                    state.chatTemplate = null;
                }

                console.log("[CONFIG] template cleared kind=" + chatKind);
                return { ok: true, kind: chatKind };
            }

            state.chatTemplate = null;
            state.chatTemplates = {};
            state.lastInjectAtMs = 0;

            console.log("[CONFIG] all templates cleared");

            return {
                ok: true
            };
        }
    };
}
