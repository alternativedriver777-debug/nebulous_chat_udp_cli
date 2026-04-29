import { copySockaddrToArray, ptrToArray } from "./memory.js";
import { state } from "./state.js";
import { nowMs, quote } from "./utils.js";

export function saveTemplate(sourceName, fd, buf, len, info, sockaddr, sockaddrLen) {
    const packet = ptrToArray(buf, len);

    let sockaddrArray = null;
    let safeSockaddrLen = 0;

    if (sourceName === "sendto" && sockaddr && !sockaddr.isNull() && sockaddrLen > 0) {
        sockaddrArray = copySockaddrToArray(sockaddr, sockaddrLen);

        if (sockaddrArray !== null) {
            safeSockaddrLen = sockaddrLen;
        }
    } else if (
        state.chatTemplate &&
        state.chatTemplate.fd === fd &&
        state.chatTemplate.sockaddrArray &&
        state.chatTemplate.sockaddrLen > 0
    ) {
        sockaddrArray = state.chatTemplate.sockaddrArray.slice(0);
        safeSockaddrLen = state.chatTemplate.sockaddrLen;
    }

    state.chatTemplate = {
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

        sockaddrArray: sockaddrArray,
        sockaddrLen: safeSockaddrLen,

        capturedAtMs: nowMs()
    };

    console.log(
        "[CHAT TEMPLATE] source=" + sourceName +
        " fd=" + fd +
        " len=" + len +
        " nick=" + quote(info.nick) +
        " msg=" + quote(info.msg)
    );
}
