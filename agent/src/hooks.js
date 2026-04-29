import { MAX_PACKET_LEN } from "./constants.js";
import { parseChatFromPtr } from "./packet.js";
import { state } from "./state.js";
import { saveTemplate } from "./template.js";

export function handleChatPacket(sourceName, fd, buf, len, sockaddr, sockaddrLen) {
    if (state.injecting) return false;
    if (len <= 0 || len > MAX_PACKET_LEN) return false;

    const info = parseChatFromPtr(buf, len);

    if (!info) {
        return false;
    }

    saveTemplate(sourceName, fd, buf, len, info, sockaddr, sockaddrLen);
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
}
