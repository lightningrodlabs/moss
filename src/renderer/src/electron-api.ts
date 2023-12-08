import {
  AppInfo,
  CallZomeRequestUnsigned,
  randomNonce,
  CallZomeRequest,
  getNonceExpiration,
  CallZomeRequestSigned,
  ActionHashB64,
  AgentPubKeyB64,
  DnaHashB64,
} from '@holochain/client';
import { encode } from '@msgpack/msgpack';
import { WeNotification } from '@lightningrodlabs/we-applet';

import { ZomeCallNapi, ZomeCallUnsignedNapi } from 'hc-we-rust-utils';

declare global {
  interface Window {
    electronAPI: {
      signZomeCall: (zomeCall: ZomeCallUnsignedNapi) => Promise<ZomeCallNapi>;
      installApp: (filePath: string, appId: string, networkSeed?: string) => Promise<void>;
      uninstallApp: (appId: string) => Promise<void>;
      openApp: (appId: string) => Promise<void>;
      getInstalledApps: () => Promise<AppInfo>;
      getConductorInfo: () => Promise<ConductorInfo>;
      installAppletBundle: (
        appId: string,
        networkSeed: string,
        membraneProofs: any,
        agentPubKey: AgentPubKeyB64,
        webHappUrl: string,
      ) => Promise<AppInfo>;
      isDevModeEnabled: () => Promise<boolean>;
      joinGroup: (networkSeed: string) => Promise<AppInfo>;
      enableDevMode: () => Promise<void>;
      disableDevMode: () => Promise<void>;
      fetchIcon: (appActionHashB64: ActionHashB64) => Promise<string>;
    };
  }
}

export interface ConductorInfo {
  app_port: number;
  admin_port: number;
  appstore_app_id: string;
}

export async function joinGroup(networkSeed: string): Promise<AppInfo> {
  return window.electronAPI.joinGroup(networkSeed);
  // const appInfo: AppInfo = await invoke('join_group', {
  //   networkSeed,
  // });

  // for (const [_role, cells] of Object.entries(appInfo.cell_info)) {
  //   for (const cell of cells) {
  //     if (CellType.Provisioned in cell) {
  //       cell[CellType.Provisioned].cell_id = [
  //         new Uint8Array(cell[CellType.Provisioned].cell_id[0]),
  //         new Uint8Array(cell[CellType.Provisioned].cell_id[1]),
  //       ];
  //     }
  //     if (CellType.Cloned in cell) {
  //       cell[CellType.Cloned].cell_id = [
  //         new Uint8Array(cell[CellType.Cloned].cell_id[0]),
  //         new Uint8Array(cell[CellType.Cloned].cell_id[1]),
  //       ];
  //     }
  //     // if (CellType.Stem in cell) {
  //     //   cell[CellType.Stem].cell_id = [
  //     //     new Uint8Array(cell[CellType.Stem].cell_id[0]),
  //     //     new Uint8Array(cell[CellType.Stem].cell_id[1]),
  //     //   ];
  //     // }
  //   }
  // }

  // return appInfo;
}

export async function getConductorInfo(): Promise<ConductorInfo> {
  return window.electronAPI.getConductorInfo();
}

export async function openApp(appId: string): Promise<void> {
  return window.electronAPI.openApp(appId);
}

export async function isDevModeEnabled(): Promise<boolean> {
  return window.electronAPI.isDevModeEnabled();
}

export async function enableDevMode(): Promise<void> {
  return window.electronAPI.enableDevMode();
}

export async function disableDevMode(): Promise<void> {
  return window.electronAPI.disableDevMode();
}

// export async function fetchAvailableUiUpdates(): Promise<
//   Record<InstalledAppId, ResourceLocatorB64>
// > {
//   return invoke('fetch_available_ui_updates');
// }

export async function notifyElectron(
  _message: WeNotification,
  _systray: boolean,
  _os: boolean,
  // appstoreAppHashB64: ActionHashB64 | undefined,
  _appletName: string | undefined,
): Promise<void> {
  console.warn('OS NOTIFICATIONS NOT IMPLEMENTED YET.');
  // try {
  //   await invoke('notify_tauri', { message, systray, os, appletName });
  // } catch (e) {
  //   console.error("Failed to invoke tauri command 'notify': ", e);
  // }
}

// interface CallZomeRequestSignedElectron
//   extends Omit<
//     CallZomeRequestSigned,
//     'cap_secret' | 'cell_id' | 'provenance' | 'nonce' | 'zome_name' | 'fn_name' | 'expires_at'
//   > {
//   cellId: [Array<number>, Array<number>];
//   provenance: Array<number>;
//   zomeName: string;
//   fnName: string;
//   nonce: Array<number>;
//   expiresAt: number;
// }

interface CallZomeRequestUnsignedElectron
  extends Omit<
    CallZomeRequestUnsigned,
    'cap_secret' | 'cell_id' | 'provenance' | 'nonce' | 'zome_name' | 'fn_name' | 'expires_at'
  > {
  cellId: [Array<number>, Array<number>];
  provenance: Array<number>;
  zomeName: string;
  fnName: string;
  nonce: Array<number>;
  expiresAt: number;
}

export const signZomeCallElectron = async (request: CallZomeRequest) => {
  const zomeCallUnsigned: CallZomeRequestUnsignedElectron = {
    provenance: Array.from(request.provenance),
    cellId: [Array.from(request.cell_id[0]), Array.from(request.cell_id[1])],
    zomeName: request.zome_name,
    fnName: request.fn_name,
    payload: Array.from(encode(request.payload)),
    nonce: Array.from(await randomNonce()),
    expiresAt: getNonceExpiration(),
  };

  const signedZomeCallElectron: ZomeCallNapi =
    await window.electronAPI.signZomeCall(zomeCallUnsigned);

  const signedZomeCall: CallZomeRequestSigned = {
    provenance: Uint8Array.from(signedZomeCallElectron.provenance),
    cap_secret: null,
    cell_id: [
      Uint8Array.from(signedZomeCallElectron.cellId[0]),
      Uint8Array.from(signedZomeCallElectron.cellId[1]),
    ],
    zome_name: signedZomeCallElectron.zomeName,
    fn_name: signedZomeCallElectron.fnName,
    payload: Uint8Array.from(signedZomeCallElectron.payload),
    signature: Uint8Array.from(signedZomeCallElectron.signature),
    expires_at: signedZomeCallElectron.expiresAt,
    nonce: Uint8Array.from(signedZomeCallElectron.nonce),
  };

  return signedZomeCall;
};
