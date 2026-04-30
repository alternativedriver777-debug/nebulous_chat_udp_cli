export function findExport(name) {
    try {
        const p = Module.getGlobalExportByName(name);
        console.log("[+] found global export: " + name + " -> " + p);
        return p;
    } catch (e) {
        console.log("[-] getGlobalExportByName failed for " + name + ": " + e);
    }

    try {
        if (typeof Module.findGlobalExportByName === "function") {
            const p = Module.findGlobalExportByName(name);
            if (p && !p.isNull()) {
                console.log("[+] found global export via findGlobalExportByName: " + name + " -> " + p);
                return p;
            }
        }
    } catch (_) {}

    try {
        const libc = Process.getModuleByName("libc.so");
        if (libc && typeof libc.findExportByName === "function") {
            const p = libc.findExportByName(name);
            if (p && !p.isNull()) {
                console.log("[+] found libc export: " + name + " -> " + p);
                return p;
            }
        }
    } catch (_) {}

    try {
        if (typeof Module.findExportByName === "function") {
            const p = Module.findExportByName("libc.so", name);
            if (p && !p.isNull()) {
                console.log("[+] found libc export via Module.findExportByName: " + name + " -> " + p);
                return p;
            }
        }
    } catch (_) {}

    console.log("[-] export not found: " + name);
    return null;
}

export function createNativeApi() {
    const sendPtr = findExport("send");
    const sendtoPtr = findExport("sendto");
    const recvPtr = findExport("recv");
    const recvfromPtr = findExport("recvfrom");

    if (!sendPtr || !sendtoPtr) {
        throw new Error("send/sendto not found");
    }

    if (!recvPtr && !recvfromPtr) {
        console.log("[!] recv/recvfrom not found; incoming chat will be disabled");
    }

    return {
        sendPtr: sendPtr,
        sendtoPtr: sendtoPtr,
        recvPtr: recvPtr,
        recvfromPtr: recvfromPtr,
        sendNative: new NativeFunction(sendPtr, "int", [
            "int",
            "pointer",
            "int",
            "int"
        ]),
        sendtoNative: new NativeFunction(sendtoPtr, "int", [
            "int",
            "pointer",
            "int",
            "int",
            "pointer",
            "int"
        ])
    };
}
