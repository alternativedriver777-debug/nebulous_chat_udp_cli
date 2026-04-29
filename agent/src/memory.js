export function ptrToArray(buf, len) {
    const arr = [];

    for (let i = 0; i < len; i++) {
        arr.push(buf.add(i).readU8());
    }

    return arr;
}

export function arrayToMemory(arr) {
    const p = Memory.alloc(arr.length);

    for (let i = 0; i < arr.length; i++) {
        p.add(i).writeU8(arr[i] & 0xff);
    }

    return p;
}

export function copySockaddrToArray(sockaddr, sockaddrLen) {
    if (!sockaddr || sockaddr.isNull()) return null;
    if (sockaddrLen <= 0 || sockaddrLen > 128) return null;

    const arr = [];

    try {
        for (let i = 0; i < sockaddrLen; i++) {
            arr.push(sockaddr.add(i).readU8());
        }
    } catch (e) {
        console.log("[sockaddr] copy failed: " + e);
        return null;
    }

    return arr;
}

export function sockaddrArrayToMemory(arr) {
    if (!arr || arr.length <= 0) return null;
    return arrayToMemory(arr);
}
