import { createNativeApi } from "./native.js";
import { installHooks } from "./hooks.js";
import { installRpc } from "./rpc.js";

const nativeApi = createNativeApi();

installHooks(nativeApi);
installRpc(nativeApi);

console.log("[*] chat injector loaded");
console.log("[*] Send one real message per chat kind to capture templates: game/clan/private.");
