import {
  AppInfo,
  CallZomeRequest,
  CallZomeRequestSigned,
  AgentPubKeyB64,
  InstalledAppId,
  ZomeName,
  FunctionName,
  DnaHashB64,
  RoleSettingsMap,
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
import type {
  AsrIncomingEvent,
  AsrSessionOptions,
  LocalModelCapabilities,
  AsrHostStatus,
  ToolWeaveConfig,
} from '@theweave/api';
import {
  AppAssetsInfo,
  AppHashes,
  AssetSource,
  AudioCapabilities,
  AudioSourceGrantInfo,
  AudioSourcePickerRequest,
  AudioSourceRequestResult,
  DistributionInfo,
  AsrModelDownloadEnded,
  AsrModelDownloadProgress,
  AsrModelListEntry,
  HappOrWebhappInspection,
  LocalToolInfo,
  ResourceLocation,
  ToolCompatibilityId,
  ToolTransferManifest,
  ToolTransferRequest,
  WeaveDevConfig,
} from '@theweave/moss-types';
import { AppletHostResponse } from './types';

// IPC_CHANGE_HERE

/** Mirrors FeedbackRecord in src/main/feedback/recordStore.ts */
export interface FeedbackRecord {
  id: string;
  text: string;
  screenshot: string;
  mossVersion: string;
  os: string;
  timestamp: number;
  reporterId?: string;
  githubHandle?: string;
  issueNumber?: number;
  issueUrl?: string;
  state: 'open' | 'closed' | 'local-only';
  createdVia?: 'worker' | 'github';
  /** Issue thread as last synced; absent on records that were never synced. */
  comments?: FeedbackCommentWire[];
  /** Seconds; team comments created after this count as unread. */
  lastReadAt?: number;
  /** Seconds; the issue's updatedAt at the last sync, used as the next sync cursor. */
  issueUpdatedAt?: number;
  stateReason?: string;
  title?: string;
}

/** Mirrors FeedbackCommentWire in shared/utils/src/feedback/threads.ts */
export interface FeedbackCommentWire {
  id: number;
  authorLogin: string;
  authorAssociation: string;
  postedForReporter: boolean;
  body: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

/** Mirrors FeedbackRecordSummary in src/main/feedback/recordStore.ts */
export type FeedbackRecordSummary = Omit<FeedbackRecord, 'screenshot'>;

/** Mirrors FeedbackSubmitInput in src/main/feedback/ipc.ts */
export interface FeedbackSubmitInput {
  text: string;
  screenshot: string;
  mossVersion: string;
  os: string;
  githubHandle?: string;
  /** Record the report without ever contacting the worker (the Copy button). */
  localOnly?: boolean;
}

/** Mirrors FeedbackSaveReason in src/main/feedback/ipc.ts */
export type FeedbackSaveReason =
  | 'local-only'
  | 'no-worker-url'
  /** The reporter seed could not be loaded or created, so the request cannot be signed. */
  | 'no-reporter-key'
  | 'unreachable'
  | 'stale_timestamp'
  | 'rate_limited'
  | 'rejected'
  | 'conflict'
  | 'server_error';

/** Mirrors FeedbackSubmitResult in src/main/feedback/ipc.ts */
export type FeedbackSubmitResult =
  | { status: 'created'; record: FeedbackRecordSummary }
  | { status: 'saved-locally'; record: FeedbackRecordSummary; reason: FeedbackSaveReason };

/** Mirrors FeedbackReporterStatus in src/main/feedback/ipc.ts */
export interface FeedbackReporterStatus {
  reporterId?: string;
}

/** Mirrors FeedbackActionResult in src/main/feedback/ipc.ts */
export type FeedbackActionResult =
  | { ok: true; record: FeedbackRecordSummary }
  | {
      ok: false;
      reason:
        | 'no-key'
        | 'no-worker-url'
        | 'not-filed'
        | 'unreachable'
        | 'stale_timestamp'
        | 'rate_limited'
        | 'rejected'
        | 'conflict'
        | 'server_error';
    };

/** Mirrors FeedbackSyncResult in src/main/feedback/ipc.ts */
export interface FeedbackSyncResult {
  records: FeedbackRecordSummary[];
  unread: number;
}

/** Mirrors LegacyProfileInfo in src/main/legacyProfiles.ts */
export interface LegacyProfileInfo {
  appName: string;
  versionString: string;
  profileName: string;
  keystorePath: string;
  /** Lair binary version (e.g. 'lair_keystore 0.6.3') that created this keystore, if recorded */
  lairVersion: string | undefined;
  /** Last modification time (ms) of the profile's data */
  lastUsed: number;
}

/** Mirrors LegacyProfileCopyResult in src/main/filesystem.ts */
export interface LegacyProfileCopyResult {
  identity: boolean;
  groups: boolean;
}

/** Mirrors LegacyImportOffer in src/main/legacyProfiles.ts */
export interface LegacyImportOffer {
  mode: 'upgrade' | 'fork';
  profiles: LegacyProfileInfo[];
}

declare global {
  interface Window {
    __HC_ZOME_CALL_SIGNER__: {
      signZomeCall: (request: CallZomeRequest) => Promise<CallZomeRequestSigned>;
    };
    electronAPI: {
      signZomeCallApplet: (
        request: CallZomeRequest,
        callerAppletIds: string[],
      ) => Promise<CallZomeRequestSigned>;
      appletMessageToParentResponse: (response: AppletHostResponse, id: string) => Promise<void>;
      parentToAppletMessage: (
        message: ParentToAppletMessage,
        forApplets: AppletId[],
      ) => Promise<void>;
      dialogMessagebox: (
        options: Electron.MessageBoxOptions,
      ) => Promise<Electron.MessageBoxReturnValue>;
      lairSetupRequired: () => Promise<boolean>;
      findLegacyImportOffer: () => Promise<LegacyImportOffer | undefined>;
      copyLegacyProfile: (keystorePath: string) => Promise<LegacyProfileCopyResult>;
      launch: () => Promise<boolean>;
      validateMediaUrl: (
        url: string,
        kind: 'image' | 'iframe',
      ) => Promise<{ ok: true; contentType: string } | { ok: false; reason: string }>;
      installApp: (filePath: string, appId: string, networkSeed?: string) => Promise<void>;
      refreshAppletSigningScope: () => Promise<void>;
      isAppletDev: () => Promise<boolean>;
      appletDevConfig: () => Promise<WeaveDevConfig | undefined>;
      getToolCurationOverride: () => Promise<string | undefined>;
      factoryReset: () => Promise<void>;
      getNetworkOverrides: () => Promise<NetworkOverridesInfo>;
      setNetworkOverrides: (overrides: NetworkOverrides) => Promise<void>;
      clearNetworkOverrides: () => Promise<void>;
      getLanDiscovery: () => Promise<LanDiscoveryInfo>;
      setLanDiscovery: (enabled: boolean) => Promise<void>;
      relaunchMoss: () => Promise<void>;
      openLogs: () => Promise<void>;
      exportLogs: () => Promise<void>;
      stopLeftoverProcesses: () => Promise<number>;
      onAppletToParentMessage: (
        callback: (
          e: any,
          payload: {
            message: AppletToParentMessage;
            id: string;
            senderWebContentsId?: number;
          },
        ) => void,
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
      openWalWindow: (
        iframeSrc: string,
        appletId: AppletId,
        groupId: DnaHashB64,
        wal: WAL,
      ) => Promise<void>;
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
        roles_settings?: RoleSettingsMap,
        assetSource?: AssetSource,
      ) => Promise<AppInfo>;
      uninstallAppletBundle: (appId: string) => Promise<void>;
      readToolAssetsManifest: (
        request: ToolTransferRequest,
        chunkSize: number,
      ) => Promise<ToolTransferManifest | undefined>;
      listLocalTools: () => Promise<LocalToolInfo[]>;
      areToolAssetsPresent: (request: ToolTransferRequest) => Promise<boolean>;
      readToolAssetsChunk: (
        request: ToolTransferRequest,
        index: number,
        chunkSize: number,
      ) => Promise<Uint8Array>;
      storeToolAssetsFromPeer: (
        manifest: ToolTransferManifest,
        bytes: Uint8Array,
        expected: ToolTransferRequest,
      ) => Promise<void>;
      isMainWindowFocused: () => Promise<boolean | undefined>;
      isDevModeEnabled: () => Promise<boolean>;
      joinGroup: (networkSeed: string, progenitor: AgentPubKeyB64 | null) => Promise<AppInfo>;
      installGroupHapp: (useProgenitor: boolean) => Promise<AppInfo>;
      silentExportGroupsData: () => Promise<void>;
      exportGroupsData: () => Promise<void>;
      importGroupsData: (curationUrls: string[]) => Promise<GroupImportResult>;
      consumePendingGroupsImport: (curationUrls: string[]) => Promise<GroupImportResult | null>;
      onImportGroupsProgress: (
        callback: (e: Electron.IpcRendererEvent, payload: ImportGroupsProgress) => void,
      ) => void;
      notification: (
        notification: FrameNotification,
        showInSystray: boolean,
        notifyOS: boolean,
        weaveLocation: WeaveLocation | undefined,
        appletName: string | undefined,
      ) => Promise<void>;
      selectScreenOrWindow: () => Promise<string>;
      requestAudioSources: (req: {
        requestId: string;
        toolName: string;
      }) => Promise<AudioSourceRequestResult | null>;
      stopAudioSources: (
        grantId: string,
        reason: 'user-stopped' | 'iframe-unloaded',
      ) => Promise<void>;
      listAudioSourceGrants: () => Promise<AudioSourceGrantInfo[]>;
      getAudioCapabilities: () => Promise<AudioCapabilities>;
      onShowAudioSourcePicker: (
        callback: (e: any, request: AudioSourcePickerRequest) => any,
      ) => void;
      audioSourcesSelected: (pickerId: string, ids: string[] | null) => Promise<void>;
      onAudioSourceGrantsChanged: (
        callback: (e: any, grants: AudioSourceGrantInfo[]) => any,
      ) => void;
      captureScreen: () => Promise<string>;
      submitFeedback: (input: FeedbackSubmitInput) => Promise<FeedbackSubmitResult>;
      listFeedback: () => Promise<FeedbackRecordSummary[]>;
      getFeedback: (id: string) => Promise<FeedbackRecord | undefined>;
      getFeedbackReporterStatus: () => Promise<FeedbackReporterStatus>;
      syncFeedbackNow: () => Promise<FeedbackSyncResult>;
      replyFeedback: (id: string, text: string) => Promise<FeedbackActionResult>;
      resolveFeedback: (id: string) => Promise<FeedbackActionResult>;
      markFeedbackRead: (id: string) => Promise<FeedbackRecordSummary | undefined>;
      getFeedbackUnreadCount: () => Promise<number>;
      /** Returns a function that removes the listener. */
      onFeedbackUnreadChanged: (callback: (e: unknown, count: number) => void) => () => void;
      /** Returns a function that removes the listener. */
      onOpenFeedbackSettings: (callback: (e: unknown) => void) => () => void;
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
      getConductorProcessMemory: () => Promise<{
        rssBytes: number;
        vmSizeBytes: number;
        pid: number;
      } | null>;
      fetchAndValidateHappOrWebhapp: (
        url: string,
        uiPort?: number,
      ) => Promise<HappOrWebhappInspection>;
      validateHappOrWebhapp: (bytes: number[]) => Promise<AppHashes>;
      // Dev UI Override
      selectDevUiWebhapp: () => Promise<string | undefined>;
      setDevUiOverride: (
        appId: string,
        webhappPath: string,
      ) => Promise<{ uiSha256: string; happSha256: string; happHashMatch: boolean }>;
      clearDevUiOverride: (appId: string) => Promise<void>;
      getDevUiOverride: (appId: string) => Promise<{ active: boolean; uiSha256?: string }>;
      lanBeaconSetListening: (listening: boolean) => Promise<void>;
      lanBeaconStartAdvertising: (
        payload: Uint8Array,
        durationMs: number,
      ) => Promise<number | undefined>;
      lanBeaconSetHello: (payload: Uint8Array) => Promise<void>;
      lanBeaconStopAdvertising: (id?: number) => Promise<void>;
      lanBeaconUnicast: (payload: Uint8Array, address: string, port: number) => Promise<void>;
      lanBeaconDiagnostics: () => Promise<{
        bound: boolean;
        interfaces: string[];
        advertising: boolean;
        advertisementId: number | undefined;
        sent: number;
        received: number;
        dropped: number;
      }>;
      onLanBeaconDatagram: (
        callback: (
          e: unknown,
          payload: { bytes: Uint8Array; address: string; port: number },
        ) => unknown,
      ) => void;
      // ── Local ASR (whisper.cpp via Moss main) ──
      asrRequestConsent: (req: {
        appletName: string;
        senderWebContentsId?: number;
      }) => Promise<'granted' | 'denied'>;
      asrWarmUp: () => Promise<void>;
      asrStatus: () => Promise<AsrHostStatus>;
      onAsrStatus: (
        callback: (e: Electron.IpcRendererEvent, status: AsrHostStatus) => void,
      ) => void;
      asrCapabilities: () => Promise<LocalModelCapabilities>;
      asrOpenSession: (opts: AsrSessionOptions) => Promise<{ sessionId: string }>;
      asrPushAudio: (req: {
        sessionId: string;
        pcm: Uint8Array;
        endOfUtterance?: boolean;
      }) => Promise<void>;
      asrCloseSession: (req: { sessionId: string }) => Promise<void>;
      asrModelsList: () => Promise<AsrModelListEntry[]>;
      asrModelDownload: (req: { id: string }) => Promise<'complete' | 'cancelled'>;
      asrModelCancelDownload: (req: { id: string }) => Promise<void>;
      asrModelDelete: (req: { id: string }) => Promise<void>;
      asrModelSelect: (req: { id: string }) => Promise<void>;
      asrOpenSessionCount: () => Promise<number>;
      onAsrModelDownloadProgress: (
        callback: (e: Electron.IpcRendererEvent, p: AsrModelDownloadProgress) => void,
      ) => () => void;
      onAsrModelDownloadEnded: (
        callback: (e: Electron.IpcRendererEvent, ended: AsrModelDownloadEnded) => void,
      ) => () => void;
      onWalWindowClosed: (
        callback: (e: Electron.IpcRendererEvent, info: { webContentsId: number }) => void,
      ) => void;
      onAsrEvent: (
        callback: (e: Electron.IpcRendererEvent, event: AsrIncomingEvent) => void,
      ) => void;
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

export interface NetworkInfo {
  bootstrap_urls: string[];
  relay_urls: string[];
}

export interface NetworkOverrides {
  bootstrapUrl?: string;
  relayUrl?: string;
}

export interface NetworkOverridesInfo {
  overrides: NetworkOverrides;
  defaults: { bootstrapUrl: string; relayUrl: string };
  current: { bootstrapUrl: string; relayUrl: string };
}

/**
 * Local Discovery (mDNS) state. `saved` is what the next launch will use,
 * `running` is what this launch is using; they differ until Moss relaunches.
 */
export interface LanDiscoveryInfo {
  saved: boolean;
  running: boolean;
  /** This launch was started with --disable-mdns, which overrides `saved`. */
  disabledByFlag: boolean;
}

export interface ConductorInfo {
  app_port: number;
  admin_port: number;
  moss_version: string;
  weave_protocol_version: string;
  network_info: NetworkInfo;
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

export async function silentExportGroupsData(): Promise<void> {
  return window.electronAPI.silentExportGroupsData();
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
  status?:
    | 'created'
    | 'joined'
    | 'joined-no-profile'
    | 'imported-disabled'
    | 'already-installed'
    | 'error';
  error?: string;
  toolName?: string;
  toolIndex?: number;
  toolTotal?: number;
};

export type SkippedImportTool = {
  name: string;
  /** 'not-available': no version for this Moss version in the tool list */
  reason: 'not-available' | 'failed';
  error?: string;
};

export type GroupImportResult = Array<{
  groupName: string | undefined;
  status:
    | 'created'
    | 'joined'
    | 'joined-no-profile'
    | 'imported-disabled'
    | 'already-installed'
    | 'error';
  error?: string;
  /** Names of the Tools installed into the group */
  installedTools?: string[];
  /** Tools from the export that were not installed */
  skippedTools?: SkippedImportTool[];
  /** Number of Tools left for the group's progenitor to bring over */
  toolsAwaitingProgenitor?: number;
}>;

export async function importGroupsData(curationUrls: string[]): Promise<GroupImportResult> {
  return window.electronAPI.importGroupsData(curationUrls);
}

export async function consumePendingGroupsImport(
  curationUrls: string[],
): Promise<GroupImportResult | null> {
  return window.electronAPI.consumePendingGroupsImport(curationUrls);
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

export async function isDevModeEnabled(): Promise<boolean> {
  return window.electronAPI.isDevModeEnabled();
}

export async function isAppletDev(): Promise<boolean> {
  return window.electronAPI.isAppletDev();
}

export async function appletDevConfig(): Promise<WeaveDevConfig | undefined> {
  return window.electronAPI.appletDevConfig();
}

export async function selectScreenOrWindow(): Promise<string> {
  return window.electronAPI.selectScreenOrWindow();
}

export async function requestAudioSources(req: { requestId: string; toolName: string }) {
  return window.electronAPI.requestAudioSources(req);
}
export async function stopAudioSources(
  grantId: string,
  reason: 'user-stopped' | 'iframe-unloaded',
) {
  return window.electronAPI.stopAudioSources(grantId, reason);
}
export async function listAudioSourceGrants() {
  return window.electronAPI.listAudioSourceGrants();
}
export async function getAudioCapabilities() {
  return window.electronAPI.getAudioCapabilities();
}
export function onAudioSourceGrantsChanged(callback: (grants: AudioSourceGrantInfo[]) => void) {
  window.electronAPI.onAudioSourceGrantsChanged((_e, grants) => callback(grants));
}

export async function fetchAndValidateHappOrWebhapp(
  url: string,
  uiPort?: number,
): Promise<HappOrWebhappInspection> {
  return window.electronAPI.fetchAndValidateHappOrWebhapp(url, uiPort);
}

export async function validateHappOrWebhapp(bytes: number[]) {
  return window.electronAPI.validateHappOrWebhapp(bytes);
}

export const signZomeCallApplet = async (request: CallZomeRequest, callerAppletIds: string[]) => {
  return window.electronAPI.signZomeCallApplet(request, callerAppletIds);
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
