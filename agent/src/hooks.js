import { CHAT_KIND_BY_OPCODE, MAX_PACKET_LEN } from "./constants.js";
import { parseChatFromPtr } from "./packet.js";
import { state } from "./state.js";
import { saveTemplate } from "./template.js";
import { handleIncomingPacket } from "./receiver.js";

export function handleChatPacket(sourceName, fd, buf, len, sockaddr, sockaddrLen) {
    if (state.injecting) return false;
    if (len <= 0 || len > MAX_PACKET_LEN) return false;

    const firstOpcode = buf.readU8() & 0xff;

    if (
        CHAT_KIND_BY_OPCODE[firstOpcode] &&
        saveTemplateAtOffset(sourceName, fd, buf, len, 0, sockaddr, sockaddrLen)
    ) {
        return true;
    }

    for (let offset = 1; offset < len; offset++) {
        const opcode = buf.add(offset).readU8() & 0xff;

        if (!CHAT_KIND_BY_OPCODE[opcode]) {
            continue;
        }

        if (saveTemplateAtOffset(sourceName, fd, buf, len, offset, sockaddr, sockaddrLen)) {
            return true;
        }
    }

    return false;
}

function saveTemplateAtOffset(sourceName, fd, buf, len, offset, sockaddr, sockaddrLen) {
    const info = parseChatFromPtr(buf.add(offset), len - offset, "send");

    if (!info) {
        return false;
    }

    saveTemplate(sourceName, fd, buf.add(offset), len - offset, info, sockaddr, sockaddrLen);
    return true;
}

export function installHooks(nativeApi) {
    Interceptor.attach(nativeApi.sendtoPtr, {
        onEnter(args) {
            const fd = args[0].toInt32();
            const buf = args[1];
            const len = args[2].toInt32();
            const sockaddr = args[4];
            const sockaddrLen = args[5].toInt32();

            handleChatPacket("sendto", fd, buf, len, sockaddr, sockaddrLen);
        }
    });

    console.log("[+] sendto hooked");

    Interceptor.attach(nativeApi.sendPtr, {
        onEnter(args) {
            const fd = args[0].toInt32();
            const buf = args[1];
            const len = args[2].toInt32();

            handleChatPacket("send", fd, buf, len, null, 0);
        }
    });

    console.log("[+] send hooked");

    if (nativeApi.recvfromPtr) {
        Interceptor.attach(nativeApi.recvfromPtr, {
            onEnter(args) {
                this.fd = args[0].toInt32();
                this.buf = args[1];
            },

            onLeave(retval) {
                const len = retval.toInt32();

                if (len <= 0) return;

                handleIncomingPacket("recvfrom", this.fd, this.buf, len);
            }
        });

        console.log("[+] recvfrom hooked");
    } else {
        console.log("[!] recvfrom not hooked: pointer is null");
    }

    if (nativeApi.recvPtr) {
        Interceptor.attach(nativeApi.recvPtr, {
            onEnter(args) {
                this.fd = args[0].toInt32();
                this.buf = args[1];
            },

            onLeave(retval) {
                const len = retval.toInt32();

                if (len <= 0) return;

                handleIncomingPacket("recv", this.fd, this.buf, len);
            }
        });

        console.log("[+] recv hooked");
    } else {
        console.log("[!] recv not hooked: pointer is null");
    }
}
