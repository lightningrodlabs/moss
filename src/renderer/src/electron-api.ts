import {
  AppInfo,
  CallZomeRequestUnsigned,
  randomNonce,
  CallZomeRequest,
  getNonceExpiration,
  CallZomeRequestSigned,
  ActionHashB64,
  AgentPubKeyB64,
  InstalledAppId,
  DnaHashB64,
  FunctionName,
  ZomeName,
} from '@holochain/client';
import { encode } from '@msgpack/msgpack';
import { AppletId, FrameNotification } from '@lightningrodlabs/we-applet';

import { ZomeCallNapi, ZomeCallUnsignedNapi } from '@lightningrodlabs/we-rust-utils';
import { AppAssetsInfo, AppHashes, DistributionInfo } from './types';

// IPC_CHANGE_HERE

declare global {
  interface Window {
    electronAPI: {
      signZomeCall: (zomeCall: ZomeCallUnsignedNapi) => Promise<ZomeCallNapi>;
      signZomeCallApplet: (zomeCall: ZomeCallUnsignedNapi) => Promise<ZomeCallNapi>;
      dialogMessagebox: (
        options: Electron.MessageBoxOptions,
      ) => Promise<Electron.MessageBoxReturnValue>;
      installApp: (filePath: string, appId: string, networkSeed?: string) => Promise<void>;
      isAppletDev: () => Promise<boolean>;
      onDeepLinkReceived: (callback: (e: any, payload: string) => any) => any;
      onSwitchToApplet: (callback: (e: any, payload: AppletId) => any) => any;
      onZomeCallSigned: (
        callback: (
          e: any,
          payload: {
            cellIdB64: [DnaHashB64, AgentPubKeyB64];
            fnName: FunctionName;
            zomeName: ZomeName;
          },
        ) => any,
      ) => any;
      openApp: (appId: string) => Promise<void>;
      getAllAppAssetsInfos: () => Promise<Record<InstalledAppId, AppAssetsInfo>>;
      getAppletDevPort: (appId: string) => Promise<number>;
      getAppletIframeScript: () => Promise<string>;
      getAppVersion: () => Promise<string>;
      getInstalledApps: () => Promise<AppInfo>;
      getConductorInfo: () => Promise<ConductorInfo>;
      installAppletBundle: (
        appId: string,
        networkSeed: string,
        membraneProofs: any,
        agentPubKey: AgentPubKeyB64,
        happOrWebHappUrl: string,
        distributionInfo: DistributionInfo,
        sha256Happ: string,
        sha256Ui?: string,
        sha256Webhapp?: string,
        metadata?: string,
      ) => Promise<AppInfo>;
      isMainWindowFocused: () => Promise<boolean | undefined>;
      isDevModeEnabled: () => Promise<boolean>;
      joinGroup: (networkSeed: string) => Promise<AppInfo>;
      notification: (
        notification: FrameNotification,
        showInSystray: boolean,
        notifyOS: boolean,
        appletId: AppletId | undefined,
        appletName: string | undefined,
      ) => Promise<void>;
      enableDevMode: () => Promise<void>;
      disableDevMode: () => Promise<void>;
      fetchIcon: (appActionHashB64: ActionHashB64) => Promise<string>;
      selectScreenOrWindow: () => Promise<string>;
      updateAppletUi: (
        appId: string,
        happOrWebHappUrl: string,
        distributionInfo: DistributionInfo,
        sha256Happ: string,
        sha256Ui: string,
        sha256Webhapp: string,
      ) => Promise<void>;
      uninstallApplet: (appId: string) => Promise<void>;
      validateHappOrWebhapp: (bytes: number[]) => Promise<AppHashes>;
    };
    __ZOME_CALL_LOGGING_ENABLED__: boolean;
  }
}

export interface ConductorInfo {
  app_port: number;
  admin_port: number;
  appstore_app_id: string;
}

export async function joinGroup(networkSeed: string): Promise<AppInfo> {
  return window.electronAPI.joinGroup(networkSeed);
}

export async function dialogMessagebox(
  options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  return window.electronAPI.dialogMessagebox(options);
}

export async function getAllAppAssetsInfos(): Promise<Record<InstalledAppId, AppAssetsInfo>> {
  return window.electronAPI.getAllAppAssetsInfos();
}

export async function getAppletDevPort(appId: string): Promise<number> {
  return window.electronAPI.getAppletDevPort(appId);
}

export async function getAppletIframeScript(): Promise<string> {
  return window.electronAPI.getAppletIframeScript();
}

export async function getAppVersion(): Promise<string> {
  return window.electronAPI.getAppVersion();
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

export async function isAppletDev(): Promise<boolean> {
  return window.electronAPI.isAppletDev();
}

export async function enableDevMode(): Promise<void> {
  return window.electronAPI.enableDevMode();
}

export async function disableDevMode(): Promise<void> {
  return window.electronAPI.disableDevMode();
}

export async function selectScreenOrWindow(): Promise<string> {
  return window.electronAPI.selectScreenOrWindow();
}

export async function validateHappOrWebhapp(bytes: number[]) {
  return window.electronAPI.validateHappOrWebhapp(bytes);
}

// export async function fetchAvailableUiUpdates(): Promise<
//   Record<InstalledAppId, ResourceLocatorB64>
// > {
//   return invoke('fetch_available_ui_updates');
// }

export async function notifyElectron(
  _message: FrameNotification,
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

export const signZomeCallApplet = async (request: CallZomeRequest) => {
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
    await window.electronAPI.signZomeCallApplet(zomeCallUnsigned);

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
