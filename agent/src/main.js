import { createNativeApi } from "./native.js";
import { installHooks } from "./hooks.js";
import { installRpc } from "./rpc.js";

const nativeApi = createNativeApi();

installHooks(nativeApi);
installRpc(nativeApi);

console.log("[*] chat injector loaded");
console.log("[*] Send any message in real Nebulous.io chat to capture template.");
