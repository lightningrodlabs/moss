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
import {
  AppletId,
  AppletToParentMessage,
  FrameNotification,
  GroupProfile as GroupProfilePartial,
  ParentToAppletMessage,
  WAL,
} from '@theweave/api';

import {
  AppAssetsInfo,
  AppHashes,
  DistributionInfo,
  ResourceLocation,
  ToolCompatibilityId,
  WeaveDevConfig,
} from '@theweave/moss-types';
import { ToolWeaveConfig } from './types';

// IPC_CHANGE_HERE

declare global {
  interface Window {
    __HC_ZOME_CALL_SIGNER__: {
      signZomeCall: (request: CallZomeRequest) => Promise<CallZomeRequestSigned>;
    };
    electronAPI: {
      signZomeCallApplet: (request: CallZomeRequest) => Promise<CallZomeRequestSigned>;
      appletMessageToParentResponse: (response: any, id: string) => Promise<void>;
      parentToAppletMessage: (
        message: ParentToAppletMessage,
        forApplets: AppletId[],
      ) => Promise<void>;
      dialogMessagebox: (
        options: Electron.MessageBoxOptions,
      ) => Promise<Electron.MessageBoxReturnValue>;
      installApp: (filePath: string, appId: string, networkSeed?: string) => Promise<void>;
      isAppletDev: () => Promise<boolean>;
      appletDevConfig: () => Promise<WeaveDevConfig | undefined>;
      factoryReset: () => Promise<void>;
      openLogs: () => Promise<void>;
      exportLogs: () => Promise<void>;
      onAppletToParentMessage: (
        callback: (e: any, payload: { message: AppletToParentMessage; id: string }) => void,
      ) => void;
      onDeepLinkReceived: (callback: (e: any, payload: string) => any) => void;
      onSwitchToApplet: (callback: (e: any, payload: AppletId) => any) => void;
      onMossUpdateProgress: (callback: (e: any, payload: ProgressInfo) => any) => void;
      onRequestFactoryReset: (callback: (e: any) => any) => void;
      onWillNavigateExternal: (callback: (e: any) => any) => void;
      removeWillNavigateListeners: () => void;
      onZomeCallSigned: (
        callback: (
          e: any,
          payload: {
            cellIdB64: [DnaHashB64, AgentPubKeyB64];
            fnName: FunctionName;
            zomeName: ZomeName;
          },
        ) => any,
      ) => void;
      closeMainWindow: () => Promise<void>;
      openApp: (appId: string) => Promise<void>;
      openWalWindow: (iframeSrc: string, appletId: AppletId, wal: WAL) => Promise<void>;
      getAllAppAssetsInfos: () => Promise<
        Record<InstalledAppId, [AppAssetsInfo, ToolWeaveConfig | undefined]>
      >;
      getAppletDevPort: (appId: string) => Promise<number>;
      getAppletIframeScript: () => Promise<string>;
      getAppVersion: () => Promise<string>;
      getInstalledApps: () => Promise<AppInfo[]>;
      getConductorInfo: () => Promise<ConductorInfo>;
      storeGroupProfile: (
        groupDnaHashB64: DnaHashB64,
        groupProfile: GroupProfilePartial,
      ) => Promise<void>;
      getGroupProfile: (groupDnaHashB64: DnaHashB64) => Promise<GroupProfilePartial | undefined>;
      getToolIcon: (
        toolId: string,
        resourceLocation?: ResourceLocation,
      ) => Promise<string | undefined>;
      mossUpdateAvailable: () => Promise<MossUpdateInfo | undefined>;
      installMossUpdate: () => Promise<void>;
      installAppletBundle: (
        appId: string,
        networkSeed: string,
        happOrWebHappUrl: string,
        distributionInfo: DistributionInfo,
        appHashes: AppHashes,
        uiPort?: number,
      ) => Promise<AppInfo>;
      uninstallAppletBundle: (appId: string) => Promise<void>;
      isMainWindowFocused: () => Promise<boolean | undefined>;
      isDevModeEnabled: () => Promise<boolean>;
      joinGroup: (networkSeed: string, progenitor: AgentPubKeyB64 | null) => Promise<AppInfo>;
      createGroup: (useProgenitor: boolean) => Promise<AppInfo>;
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
      batchUpdateAppletUis: (
        toolCompatibilityId: ToolCompatibilityId,
        happOrWebHappUrl: string,
        distributionInfo: DistributionInfo,
        sha256Happ: string,
        sha256Ui: string,
        sha256Webhapp: string,
      ) => Promise<AppletId[]>;
      updateAppletUi: (
        appId: string,
        happOrWebHappUrl: string,
        distributionInfo: DistributionInfo,
        sha256Happ: string,
        sha256Ui: string,
        sha256Webhapp: string,
      ) => Promise<void>;
      uninstallApplet: (appId: string) => Promise<void>;
      dumpNetworkStats: () => Promise<void>;
      fetchAndValidateHappOrWebhapp: (url: string) => Promise<AppHashes>;
      validateHappOrWebhapp: (bytes: number[]) => Promise<AppHashes>;
    };
    __ZOME_CALL_LOGGING_ENABLED__: boolean;
  }
}

export interface MossUpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes: string | undefined;
}
export interface ProgressInfo {
  total: number;
  delta: number;
  transferred: number;
  percent: number;
  bytesPerSecond: number;
}

export interface ConductorInfo {
  app_port: number;
  admin_port: number;
  moss_version: string;
  weave_protocol_version: string;
}

export async function joinGroup(
  networkSeed: string,
  progenitor: AgentPubKeyB64 | null,
): Promise<AppInfo> {
  return window.electronAPI.joinGroup(networkSeed, progenitor);
}

export async function createGroup(useProgenitor: boolean): Promise<AppInfo> {
  return window.electronAPI.createGroup(useProgenitor);
}

export async function dialogMessagebox(
  options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  return window.electronAPI.dialogMessagebox(options);
}

export async function getAllAppAssetsInfos(): Promise<
  Record<InstalledAppId, [AppAssetsInfo, ToolWeaveConfig | undefined]>
> {
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

export async function storeGroupProfile(
  groupDnaHashB64: DnaHashB64,
  groupProfile: GroupProfilePartial,
): Promise<void> {
  return window.electronAPI.storeGroupProfile(groupDnaHashB64, groupProfile);
}

export async function getGroupProfile(
  groupDnaHashB64: DnaHashB64,
): Promise<GroupProfilePartial | undefined> {
  return window.electronAPI.getGroupProfile(groupDnaHashB64);
}

export async function getToolIcon(
  toolId: string,
  resourceLocation?: ResourceLocation,
): Promise<string | undefined> {
  return window.electronAPI.getToolIcon(toolId, resourceLocation);
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

export async function appletDevConfig(): Promise<WeaveDevConfig | undefined> {
  return window.electronAPI.appletDevConfig();
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

export async function fetchAndValidateHappOrWebhapp(url: string) {
  return window.electronAPI.fetchAndValidateHappOrWebhapp(url);
}

export async function validateHappOrWebhapp(bytes: number[]) {
  return window.electronAPI.validateHappOrWebhapp(bytes);
}

export const signZomeCallApplet = async (request: CallZomeRequest) => {
  return window.electronAPI.signZomeCallApplet(request);
};
