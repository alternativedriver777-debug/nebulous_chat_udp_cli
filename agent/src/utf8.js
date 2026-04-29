function codePointToString(cp) {
    if (cp <= 0xffff) {
        return String.fromCharCode(cp);
    }

    cp -= 0x10000;
    return String.fromCharCode(
        0xd800 + ((cp >> 10) & 0x3ff),
        0xdc00 + (cp & 0x3ff)
    );
}

export function utf8Decode(bytes) {
    let out = "";

    for (let i = 0; i < bytes.length;) {
        const b0 = bytes[i] & 0xff;

        if (b0 <= 0x7f) {
            out += String.fromCharCode(b0);
            i++;
            continue;
        }

        if ((b0 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
            const b1 = bytes[i + 1] & 0xff;

            if ((b1 & 0xc0) === 0x80) {
                const cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
                out += codePointToString(cp);
                i += 2;
                continue;
            }
        }

        if ((b0 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
            const b1 = bytes[i + 1] & 0xff;
            const b2 = bytes[i + 2] & 0xff;

            if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80) {
                const cp = ((b0 & 0x0f) << 12) |
                           ((b1 & 0x3f) << 6) |
                           (b2 & 0x3f);

                out += codePointToString(cp);
                i += 3;
                continue;
            }
        }

        if ((b0 & 0xf8) === 0xf0 && i + 3 < bytes.length) {
            const b1 = bytes[i + 1] & 0xff;
            const b2 = bytes[i + 2] & 0xff;
            const b3 = bytes[i + 3] & 0xff;

            if (
                (b1 & 0xc0) === 0x80 &&
                (b2 & 0xc0) === 0x80 &&
                (b3 & 0xc0) === 0x80
            ) {
                const cp = ((b0 & 0x07) << 18) |
                           ((b1 & 0x3f) << 12) |
                           ((b2 & 0x3f) << 6) |
                           (b3 & 0x3f);

                out += codePointToString(cp);
                i += 4;
                continue;
            }
        }

        out += "\ufffd";
        i++;
    }

    return out;
}

export function utf8Encode(text) {
    const s = String(text);
    const out = [];

    for (let i = 0; i < s.length; i++) {
        let cp = s.charCodeAt(i);

        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
            const lo = s.charCodeAt(i + 1);

            if (lo >= 0xdc00 && lo <= 0xdfff) {
                cp = 0x10000 + (((cp - 0xd800) << 10) | (lo - 0xdc00));
                i++;
            }
        }

        if (cp <= 0x7f) {
            out.push(cp);
        } else if (cp <= 0x7ff) {
            out.push(
                0xc0 | (cp >> 6),
                0x80 | (cp & 0x3f)
            );
        } else if (cp <= 0xffff) {
            out.push(
                0xe0 | (cp >> 12),
                0x80 | ((cp >> 6) & 0x3f),
                0x80 | (cp & 0x3f)
            );
        } else {
            out.push(
                0xf0 | (cp >> 18),
                0x80 | ((cp >> 12) & 0x3f),
                0x80 | ((cp >> 6) & 0x3f),
                0x80 | (cp & 0x3f)
            );
        }
    }

    return out;
}
