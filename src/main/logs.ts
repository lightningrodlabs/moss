import { HOLOCHAIN_ERROR, HOLOCHAIN_LOG, HolochainData, LAIR_ERROR, LAIR_LOG, LauncherEmitter, WASM_LOG } from "./launcherEmitter";


export function setupLogs(launcherEmitter: LauncherEmitter) {
  launcherEmitter.on(LAIR_LOG, (log) => console.log("[LAIR]: ", log));
  launcherEmitter.on(LAIR_ERROR, (log) => console.log("[LAIR] ERROR: ", log));
  launcherEmitter.on(HOLOCHAIN_LOG, (holochainData) => console.log(`[HOLOCHAIN ${(holochainData as HolochainData).version}]: `, (holochainData as HolochainData).data));
  launcherEmitter.on(HOLOCHAIN_ERROR, (holochainData) => console.log(`[HOLOCHAIN ${(holochainData as HolochainData).version}] ERROR: ${(holochainData as HolochainData).data}`));
  launcherEmitter.on(WASM_LOG, (holochainData) => console.log(`[HOLOCHAIN ${(holochainData as HolochainData).version}] WASM: ${(holochainData as HolochainData).data}`));
}