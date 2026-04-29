export function nowMs() {
    return Date.now();
}

export function quote(s) {
    try {
        return JSON.stringify(String(s));
    } catch (_) {
        return '"' + String(s) + '"';
    }
}
