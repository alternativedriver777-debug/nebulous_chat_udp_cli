export const CHAT_OPCODE = 0x89;
export const CHAT_KIND_GAME = "game";
export const CHAT_KIND_CLAN = "clan";
export const CHAT_KIND_PRIVATE = "private";
export const CHAT_KIND_ALL = "all";

export const CHAT_KINDS = [
    CHAT_KIND_GAME,
    CHAT_KIND_CLAN,
    CHAT_KIND_PRIVATE
];

export const CHAT_OPCODE_BY_KIND = {
    game: 0x89,
    clan: 0x09,
    private: 0x24
};

export const CHAT_KIND_BY_OPCODE = {
    0x89: CHAT_KIND_GAME,
    0x09: CHAT_KIND_CLAN,
    0x24: CHAT_KIND_PRIVATE
};

export const CHAT_LABEL_BY_KIND = {
    game: "CHAT",
    clan: "CLAN",
    private: "PM"
};

export const DEFAULT_SEND_KIND = CHAT_KIND_GAME;
export const MAX_PACKET_LEN = 8192;
export const HARD_MAX_MESSAGE_BYTES = 4096;
export const DEFAULT_MAX_LEN_BYTES = 128;
export const DEFAULT_RATE_LIMIT_MS = 1000;
