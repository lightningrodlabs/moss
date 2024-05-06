import {
  AppInfo,
  CallZomeRequest,
  CallZomeRequestSigned,
  ActionHashB64,
  AgentPubKeyB64,
  InstalledAppId,
  ZomeName,
  FunctionName,
  DnaHashB64,
} from '@holochain/client';
import { AppletId, FrameNotification } from '@lightningrodlabs/we-applet';

import { AppAssetsInfo, AppHashes, DistributionInfo } from './types';

// IPC_CHANGE_HERE

declare global {
  interface Window {
    __HC_ZOME_CALL_SIGNER__: {
      signZomeCall: (request: CallZomeRequest) => Promise<CallZomeRequestSigned>;
    };
    electronAPI: {
      signZomeCallApplet: (request: CallZomeRequest) => Promise<CallZomeRequestSigned>;
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
  tools_library_app_id: string;
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

export const signZomeCallApplet = async (request: CallZomeRequest) => {
  return window.electronAPI.signZomeCallApplet(request);
};
