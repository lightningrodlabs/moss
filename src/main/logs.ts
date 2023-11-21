import { HOLOCHAIN_ERROR, HOLOCHAIN_LOG, HolochainData, LAIR_ERROR, LAIR_LOG, LauncherEmitter, WASM_LOG } from "./launcherEmitter";


export function setupLogs(launcherEmitter: LauncherEmitter) {
  launcherEmitter.on(LAIR_LOG, (log) => console.log("[LAIR]: ", log));
  launcherEmitter.on(LAIR_ERROR, (log) => console.log("[LAIR] ERROR: ", log));
  launcherEmitter.on(HOLOCHAIN_LOG, (holochainData: HolochainData) => console.log(`[HOLOCHAIN ${holochainData.version}]: `, holochainData.data));
  launcherEmitter.on(HOLOCHAIN_ERROR, (holochainData: HolochainData) => console.log(`[HOLOCHAIN ${holochainData.version}] ERROR: ${holochainData.data}`));
  launcherEmitter.on(WASM_LOG, (holochainData: HolochainData) => console.log(`[HOLOCHAIN ${holochainData.version}] WASM: ${holochainData.data}`));
}