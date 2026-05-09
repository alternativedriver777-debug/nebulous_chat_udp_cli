import { copySockaddrToArray, ptrToArray } from "./memory.js";
import { state } from "./state.js";
import { nowMs, quote } from "./utils.js";

function findSockaddrForFd(fd, preferredKind) {
    const templates = state.chatTemplates || {};

    if (
        preferredKind &&
        templates[preferredKind] &&
        templates[preferredKind].fd === fd &&
        templates[preferredKind].sockaddrArray &&
        templates[preferredKind].sockaddrLen > 0
    ) {
        return {
            sockaddrArray: templates[preferredKind].sockaddrArray.slice(0),
            sockaddrLen: templates[preferredKind].sockaddrLen
        };
    }

    for (const kind in templates) {
        const template = templates[kind];

        if (
            template &&
            template.fd === fd &&
            template.sockaddrArray &&
            template.sockaddrLen > 0
        ) {
            return {
                sockaddrArray: template.sockaddrArray.slice(0),
                sockaddrLen: template.sockaddrLen
            };
        }
    }

    if (
        state.chatTemplate &&
        state.chatTemplate.fd === fd &&
        state.chatTemplate.sockaddrArray &&
        state.chatTemplate.sockaddrLen > 0
    ) {
        return {
            sockaddrArray: state.chatTemplate.sockaddrArray.slice(0),
            sockaddrLen: state.chatTemplate.sockaddrLen
        };
    }

    return {
        sockaddrArray: null,
        sockaddrLen: 0
    };
}

export function saveTemplate(sourceName, fd, buf, len, info, sockaddr, sockaddrLen) {
    const packet = ptrToArray(buf, len);
    const kind = info.kind || "game";

    let sockaddrArray = null;
    let safeSockaddrLen = 0;

    if (sourceName === "sendto" && sockaddr && !sockaddr.isNull() && sockaddrLen > 0) {
        sockaddrArray = copySockaddrToArray(sockaddr, sockaddrLen);

        if (sockaddrArray !== null) {
            safeSockaddrLen = sockaddrLen;
        }
    } else {
        const known = findSockaddrForFd(fd, kind);
        sockaddrArray = known.sockaddrArray;
        safeSockaddrLen = known.sockaddrLen;
    }

    const template = {
        kind: kind,
        source: sourceName,
        fd: fd,

        packet: packet,
        packetLen: packet.length,

        nick: info.nick,
        lastMessage: info.msg,

        nickLen: info.nickLen,
        msgLen: info.msgLen,
        msgLenOffset: info.msgLenOffset,
        msgStart: info.msgStart,
        msgEnd: info.msgEnd,
        tailOffset: info.tailOffset,
        tailLen: info.tailLen,
        targetId: info.targetId,
        id1: info.id1,
        id2: info.id2,

        sockaddrArray: sockaddrArray,
        sockaddrLen: safeSockaddrLen,

        capturedAtMs: nowMs()
    };

    if (!state.chatTemplates) {
        state.chatTemplates = {};
    }

    state.chatTemplates[kind] = template;

    if (kind === "game" || !state.chatTemplate) {
        state.chatTemplate = template;
    }

    console.log(
        "[CHAT TEMPLATE] kind=" + kind +
        " source=" + sourceName +
        " fd=" + fd +
        " len=" + len +
        " nick=" + quote(info.nick) +
        " msg=" + quote(info.msg) +
        " targetId=" + (info.targetId === null || info.targetId === undefined ? "null" : info.targetId)
    );
}
