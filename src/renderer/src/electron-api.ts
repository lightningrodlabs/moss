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
  WeaveLocation,
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
      lairSetupRequired: () => Promise<boolean>;
      launch: () => Promise<boolean>;
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
      onSwitchToWeaveLocation: (callback: (e: any, payload: WeaveLocation) => any) => void;
      onMossUpdateProgress: (callback: (e: any, payload: ProgressInfo) => any) => void;
      onRequestFactoryReset: (callback: (e: any) => any) => void;
      onWillNavigateExternal: (callback: (e: any) => any) => void;
      onIframeStoreSync: (
        callback: (
          e: Electron.IpcRendererEvent,
          payload: [
            Record<
              AppletId,
              Array<{
                id: string;
                subType: string;
                source: MessageEventSource | null | 'wal-window';
              }>
            >,
            Record<
              ToolCompatibilityId,
              Array<{
                id: string;
                subType: string;
                source: MessageEventSource | null | 'wal-window';
              }>
            >,
          ],
        ) => any,
      ) => void;
      requestIframeStoreSync: () => void;
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
      openWalWindow: (iframeSrc: string, appletId: AppletId, groupId: DnaHashB64, wal: WAL) => Promise<void>;
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
      installGroupHapp: (useProgenitor: boolean) => Promise<AppInfo>;
      exportGroupsData: () => Promise<void>;
      importGroupsData: () => Promise<GroupImportResult>;
      onImportGroupsProgress: (callback: (e: Electron.IpcRendererEvent, payload: ImportGroupsProgress) => void) => void;
      notification: (
        notification: FrameNotification,
        showInSystray: boolean,
        notifyOS: boolean,
        weaveLocation: WeaveLocation | undefined,
        appletName: string | undefined,
      ) => Promise<void>;
      enableDevMode: () => Promise<void>;
      disableDevMode: () => Promise<void>;
      fetchIcon: (appActionHashB64: ActionHashB64) => Promise<string>;
      selectScreenOrWindow: () => Promise<string>;
      captureScreen: () => Promise<string>;
      getFeedbackWorkerUrl: () => Promise<string>;
      saveFeedback: (feedback: {
        text: string;
        screenshot: string;
        mossVersion: string;
        os: string;
        timestamp: number;
        issueUrl?: string;
      }) => Promise<string>;
      listFeedback: () => Promise<
        Array<{
          id: string;
          text: string;
          mossVersion: string;
          os: string;
          timestamp: number;
          issueUrl?: string;
        }>
      >;
      getFeedback: (id: string) => Promise<{
        id: string;
        text: string;
        screenshot: string;
        mossVersion: string;
        os: string;
        timestamp: number;
        issueUrl?: string;
      } | null>;
      updateFeedbackIssueUrl: (id: string, issueUrl: string) => Promise<void>;
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
      getRendererProcessMemory: () => Promise<{
        residentSetKB: number;
        privateKB: number;
        sharedKB: number;
      }>;
      getMainProcessMemory: () => Promise<{
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
        arrayBuffers: number;
      }>;
      fetchAndValidateHappOrWebhapp: (url: string) => Promise<AppHashes>;
      validateHappOrWebhapp: (bytes: number[]) => Promise<AppHashes>;
      // Dev UI Override
      selectDevUiWebhapp: () => Promise<string | undefined>;
      setDevUiOverride: (
        appId: string,
        webhappPath: string,
      ) => Promise<{ uiSha256: string; happSha256: string; happHashMatch: boolean }>;
      clearDevUiOverride: (appId: string) => Promise<void>;
      getDevUiOverride: (
        appId: string,
      ) => Promise<{ active: boolean; uiSha256?: string }>;
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

export async function installGroupHapp(useProgenitor: boolean): Promise<AppInfo> {
  return window.electronAPI.installGroupHapp(useProgenitor);
}

export async function exportGroupsData(): Promise<void> {
  return window.electronAPI.exportGroupsData();
}

export type ImportGroupsProgress = {
  current: number;
  total: number;
  groupName: string | undefined;
  step: 'installing' | 'waiting-for-sync' | 'setting-profile' | 'installing-tool' | 'done';
  secondsLeft?: number;
  status?: 'created' | 'joined' | 'joined-no-profile' | 'already-installed' | 'error';
  error?: string;
  toolName?: string;
  toolIndex?: number;
  toolTotal?: number;
};

export type GroupImportResult = Array<{
  groupName: string | undefined;
  status: 'created' | 'joined' | 'joined-no-profile' | 'already-installed' | 'error';
  error?: string;
}>;

export async function importGroupsData(): Promise<GroupImportResult> {
  return window.electronAPI.importGroupsData();
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

export async function getConductorInfo(): Promise<ConductorInfo | undefined> {
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

// Dev UI Override

export async function selectDevUiWebhapp(): Promise<string | undefined> {
  return window.electronAPI.selectDevUiWebhapp();
}

export async function setDevUiOverride(
  appId: string,
  webhappPath: string,
): Promise<{ uiSha256: string; happSha256: string; happHashMatch: boolean }> {
  return window.electronAPI.setDevUiOverride(appId, webhappPath);
}

export async function clearDevUiOverride(appId: string): Promise<void> {
  return window.electronAPI.clearDevUiOverride(appId);
}

export async function getDevUiOverride(
  appId: string,
): Promise<{ active: boolean; uiSha256?: string }> {
  return window.electronAPI.getDevUiOverride(appId);
}
