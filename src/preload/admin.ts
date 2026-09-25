// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
// IPC_CHANGE_HERE
import { AgentPubKeyB64, CallZomeRequest, DnaHashB64, RoleSettingsMap } from '@holochain/client';
import { contextBridge, ipcRenderer } from 'electron';
import {
  AppletId,
  AppletToParentMessage,
  FrameNotification,
  GroupProfile,
  ParentToAppletMessage,
  WAL,
  WeaveLocation,
} from '@theweave/api';
import type {
  AsrIncomingEvent,
  AsrSessionOptions,
  LocalModelCapabilities,
  AsrHostStatus,
} from '@theweave/api';
import type { AppletHostResponse } from '../main/sharedTypes';
import {
  AppHashes,
  AssetSource,
  AudioSourceGrantInfo,
  AudioSourcePickerRequest,
  AudioSourcePortDelivery,
  DistributionInfo,
  ResourceLocation,
  ToolCompatibilityId,
  ToolTransferManifest,
  ToolTransferRequest,
} from '@theweave/moss-types';
import { ProgressInfo } from 'electron-updater';

contextBridge.exposeInMainWorld('__HC_ZOME_CALL_SIGNER__', {
  signZomeCall: (request: CallZomeRequest) => ipcRenderer.invoke('sign-zome-call', request),
});

contextBridge.exposeInMainWorld('electronAPI', {
  signZomeCallApplet: (request: CallZomeRequest, callerAppletIds: string[]) =>
    ipcRenderer.invoke('sign-zome-call-applet', request, callerAppletIds),
  appletMessageToParentResponse: (response: AppletHostResponse, id: string) =>
    ipcRenderer.invoke('applet-message-to-parent-response', response, id),
  parentToAppletMessage: (message: ParentToAppletMessage, forApplet: AppletId) =>
    ipcRenderer.invoke('parent-to-applet-message', message, forApplet),
  dialogMessagebox: (options: Electron.MessageBoxOptions) =>
    ipcRenderer.invoke('dialog-messagebox', options),
  installApp: (filePath: string, appId: string, networkSeed?: string) =>
    ipcRenderer.invoke('install-app', filePath, appId, networkSeed),
  refreshAppletSigningScope: () => ipcRenderer.invoke('refresh-applet-signing-scope'),
  lairSetupRequired: () => ipcRenderer.invoke('lair-setup-required'),
  findLegacyProfiles: () => ipcRenderer.invoke('find-legacy-profiles'),
  getLairBinaryVersion: () => ipcRenderer.invoke('get-lair-binary-version'),
  copyLegacyProfile: (keystorePath: string) =>
    ipcRenderer.invoke('import-legacy-profile', keystorePath),
  launch: () => ipcRenderer.invoke('launch'),
  validateMediaUrl: (url: string, kind: 'image' | 'iframe') =>
    ipcRenderer.invoke('validate-media-url', url, kind),
  isAppletDev: () => ipcRenderer.invoke('is-applet-dev'),
  appletDevConfig: () => ipcRenderer.invoke('applet-dev-config'),
  getToolCurationOverride: () => ipcRenderer.invoke('get-tool-curation-override'),
  factoryReset: () => ipcRenderer.invoke('factory-reset'),
  getNetworkOverrides: () => ipcRenderer.invoke('get-network-overrides'),
  setNetworkOverrides: (overrides: { bootstrapUrl?: string; relayUrl?: string }) =>
    ipcRenderer.invoke('set-network-overrides', overrides),
  clearNetworkOverrides: () => ipcRenderer.invoke('clear-network-overrides'),
  openLogs: () => ipcRenderer.invoke('open-logs'),
  exportLogs: () => ipcRenderer.invoke('export-logs'),
  onMossUpdateProgress: (callback: (e: Electron.IpcRendererEvent, payload: ProgressInfo) => any) =>
    ipcRenderer.on('moss-update-progress', callback),
  onRequestFactoryReset: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('request-factory-reset', callback),
  onAppletToParentMessage: (
    callback: (
      e: Electron.IpcRendererEvent,
      payload: { message: AppletToParentMessage; id: string },
    ) => any,
  ) => ipcRenderer.on('applet-to-parent-message', callback),
  onDeepLinkReceived: (callback: (e: Electron.IpcRendererEvent, payload: string) => any) =>
    ipcRenderer.on('deep-link-received', callback),
  onSwitchToWeaveLocation: (
    callback: (e: Electron.IpcRendererEvent, payload: WeaveLocation) => any,
  ) => ipcRenderer.on('switch-to-weave-location', callback),
  onWindowClosing: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('window-closing', callback),
  onWillNavigateExternal: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('will-navigate-external', callback),
  onIframeStoreSync: (callback: (e: Electron.IpcRendererEvent) => any) =>
    ipcRenderer.on('iframe-store-sync', callback),
  requestIframeStoreSync: () => ipcRenderer.invoke('request-iframe-store-sync'),
  removeWillNavigateListeners: () => ipcRenderer.removeAllListeners('will-navigate-external'),
  closeMainWindow: () => ipcRenderer.invoke('close-main-window'),
  openWalWindow: (iframeSrc: string, appletId: AppletId, groupId: DnaHashB64, wal: WAL) => {
    ipcRenderer.invoke('open-wal-window', iframeSrc, appletId, groupId, wal);
  },
  getAllAppAssetsInfos: () => ipcRenderer.invoke('get-all-app-assets-infos'),
  getAppletDevPort: (lowerCaseAppletIdB64: string) =>
    ipcRenderer.invoke('get-applet-dev-port', lowerCaseAppletIdB64),
  getAppletIframeScript: () => ipcRenderer.invoke('get-applet-iframe-script'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
  getConductorInfo: () => ipcRenderer.invoke('get-conductor-info'),
  storeGroupProfile: (groupDnaHashB64: DnaHashB64, groupProfile: GroupProfile) =>
    ipcRenderer.invoke('store-group-profile', groupDnaHashB64, groupProfile),
  getGroupProfile: (groupDnaHashB64: DnaHashB64) =>
    ipcRenderer.invoke('get-group-profile', groupDnaHashB64),
  getToolIcon: (toolId: string, resourceLocation?: ResourceLocation) =>
    ipcRenderer.invoke('get-tool-icon', toolId, resourceLocation),
  mossUpdateAvailable: () => ipcRenderer.invoke('moss-update-available'),
  installMossUpdate: () => ipcRenderer.invoke('install-moss-update'),
  installAppletBundle: (
    appId: string,
    networkSeed: string,
    happOrWebHappUrl: string,
    distributionInfo: DistributionInfo,
    appHashes: AppHashes,
    uiPort?: number,
    roles_settings?: RoleSettingsMap,
    assetSource?: AssetSource,
  ) =>
    ipcRenderer.invoke(
      'install-applet-bundle',
      appId,
      networkSeed,
      happOrWebHappUrl,
      distributionInfo,
      appHashes,
      uiPort,
      roles_settings,
      assetSource,
    ),
  readToolAssetsManifest: (request: ToolTransferRequest, chunkSize: number) =>
    ipcRenderer.invoke('read-tool-assets-manifest', request, chunkSize),
  listLocalTools: () => ipcRenderer.invoke('list-local-tools'),
  areToolAssetsPresent: (request: ToolTransferRequest) =>
    ipcRenderer.invoke('are-tool-assets-present', request),
  readToolAssetsChunk: (request: ToolTransferRequest, index: number, chunkSize: number) =>
    ipcRenderer.invoke('read-tool-assets-chunk', request, index, chunkSize),
  storeToolAssetsFromPeer: (
    manifest: ToolTransferManifest,
    bytes: Uint8Array,
    expected: ToolTransferRequest,
  ) => ipcRenderer.invoke('store-tool-assets-from-peer', manifest, bytes, expected),
  uninstallAppletBundle: (appId: string) => ipcRenderer.invoke('uninstall-applet-bundle', appId),
  isDevModeEnabled: () => ipcRenderer.invoke('is-dev-mode-enabled'),
  isMainWindowFocused: () => ipcRenderer.invoke('is-main-window-focused'),
  joinGroup: (networkSeed: string, progenitor: AgentPubKeyB64 | undefined) =>
    ipcRenderer.invoke('join-group', networkSeed, progenitor),
  installGroupHapp: (useProgenitor: boolean, customGroupSeed: string | undefined = undefined) =>
    ipcRenderer.invoke('install-group-happ', useProgenitor, customGroupSeed),
  silentExportGroupsData: () => ipcRenderer.invoke('silent-export-groups-data'),
  exportGroupsData: () => ipcRenderer.invoke('export-groups-data'),
  importGroupsData: () => ipcRenderer.invoke('import-groups-data'),
  consumePendingGroupsImport: () => ipcRenderer.invoke('consume-pending-groups-import'),
  onImportGroupsProgress: (callback: (e: Electron.IpcRendererEvent, payload: unknown) => void) =>
    ipcRenderer.on('import-groups-progress', callback),
  notification: (
    notification: FrameNotification,
    showInSystray: boolean,
    notifyOS: boolean,
    weaveLocation: WeaveLocation | undefined,
    appletName: string | undefined,
  ) =>
    ipcRenderer.invoke(
      'notification',
      notification,
      showInSystray,
      notifyOS,
      weaveLocation,
      appletName,
    ),
  selectScreenOrWindow: () => ipcRenderer.invoke('select-screen-or-window'),
  requestAudioSources: (req: { requestId: string; toolName: string }) =>
    ipcRenderer.invoke('request-audio-sources', req),
  stopAudioSources: (grantId: string, reason: 'user-stopped' | 'iframe-unloaded') =>
    ipcRenderer.invoke('stop-audio-sources', grantId, reason),
  onShowAudioSourcePicker: (
    callback: (e: Electron.IpcRendererEvent, request: AudioSourcePickerRequest) => any,
  ) => ipcRenderer.on('show-audio-source-picker', callback),
  audioSourcesSelected: (pickerId: string, ids: string[] | null) =>
    ipcRenderer.invoke('audio-sources-selected', pickerId, ids),
  listAudioSourceGrants: () => ipcRenderer.invoke('list-audio-source-grants'),
  getAudioCapabilities: () => ipcRenderer.invoke('get-audio-capabilities'),
  onAudioSourceGrantsChanged: (
    callback: (e: Electron.IpcRendererEvent, grants: AudioSourceGrantInfo[]) => any,
  ) => ipcRenderer.on('audio-source-grants-changed', callback),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  getFeedbackWorkerUrl: () => ipcRenderer.invoke('get-feedback-worker-url'),
  saveFeedback: (feedback: {
    text: string;
    screenshot: string;
    mossVersion: string;
    os: string;
    timestamp: number;
    issueUrl?: string;
  }) => ipcRenderer.invoke('save-feedback', feedback),
  listFeedback: () => ipcRenderer.invoke('list-feedback'),
  getFeedback: (id: string) => ipcRenderer.invoke('get-feedback', id),
  updateFeedbackIssueUrl: (id: string, issueUrl: string) =>
    ipcRenderer.invoke('update-feedback-issue-url', id, issueUrl),
  batchUpdateAppletUis: (
    toolCompatibilityId: ToolCompatibilityId,
    happOrWebHappUrl: string,
    distributionInfo: DistributionInfo,
    sha256Happ: string,
    sha256Ui: string,
    sha256Webhapp: string,
  ) =>
    ipcRenderer.invoke(
      'batch-update-applet-uis',
      toolCompatibilityId,
      happOrWebHappUrl,
      distributionInfo,
      sha256Happ,
      sha256Ui,
      sha256Webhapp,
    ),
  updateAppletUi: (
    appId: string,
    happOrWebHappUrl: string,
    distributionInfo: DistributionInfo,
    sha256Happ: string,
    sha256Ui: string,
    sha256Webhapp: string,
  ) =>
    ipcRenderer.invoke(
      'update-applet-ui',
      appId,
      happOrWebHappUrl,
      distributionInfo,
      sha256Happ,
      sha256Ui,
      sha256Webhapp,
    ),
  uninstallApplet: (appId: string) => ipcRenderer.invoke('uninstall-applet', appId),
  dumpNetworkStats: () => ipcRenderer.invoke('dump-network-stats'),
  getRendererProcessMemory: async () => {
    const memInfo = await process.getProcessMemoryInfo();
    return {
      residentSetKB: memInfo.residentSet,
      privateKB: memInfo.private,
      sharedKB: memInfo.shared,
    };
  },
  getMainProcessMemory: () => ipcRenderer.invoke('get-main-process-memory'),
  getConductorProcessMemory: () => ipcRenderer.invoke('get-conductor-process-memory'),
  fetchAndValidateHappOrWebhapp: (url: string) =>
    ipcRenderer.invoke('fetch-and-validate-happ-or-webhapp', url),
  validateHappOrWebhapp: (bytes: number[]) => ipcRenderer.invoke('validate-happ-or-webhapp', bytes),
  // Dev UI Override
  selectDevUiWebhapp: () => ipcRenderer.invoke('select-dev-ui-webhapp'),
  setDevUiOverride: (appId: string, webhappPath: string) =>
    ipcRenderer.invoke('set-dev-ui-override', appId, webhappPath),
  clearDevUiOverride: (appId: string) => ipcRenderer.invoke('clear-dev-ui-override', appId),
  getDevUiOverride: (appId: string) => ipcRenderer.invoke('get-dev-ui-override', appId),
  lanBeaconSetListening: (listening: boolean) =>
    ipcRenderer.invoke('lan-beacon-set-listening', listening),
  lanBeaconStartAdvertising: (payload: Uint8Array, durationMs: number) =>
    ipcRenderer.invoke('lan-beacon-start-advertising', payload, durationMs),
  lanBeaconSetHello: (payload: Uint8Array) => ipcRenderer.invoke('lan-beacon-set-hello', payload),
  lanBeaconStopAdvertising: (id?: number) => ipcRenderer.invoke('lan-beacon-stop-advertising', id),
  lanBeaconUnicast: (payload: Uint8Array, address: string, port: number) =>
    ipcRenderer.invoke('lan-beacon-unicast', payload, address, port),
  lanBeaconDiagnostics: () => ipcRenderer.invoke('lan-beacon-diagnostics'),
  onLanBeaconDatagram: (
    callback: (
      e: Electron.IpcRendererEvent,
      payload: { bytes: Uint8Array; address: string; port: number },
    ) => unknown,
  ) => ipcRenderer.on('lan-beacon-datagram', callback),

  // ── Local ASR (whisper.cpp sidecar) ──────────────────────────
  // The renderer-side bridge in applet-host.ts is the only intended
  // caller; applets reach this via WeaveClient.localModels.asr.
  // Channel contract is defined in src/main/asr/ipcHandlers.ts.
  asrRequestConsent: (req: { appletName: string; senderWebContentsId?: number }) =>
    ipcRenderer.invoke('asr-request-consent', req) as Promise<'granted' | 'denied'>,
  asrWarmUp: () => ipcRenderer.invoke('asr-warm-up') as Promise<void>,
  asrStatus: () => ipcRenderer.invoke('asr-status') as Promise<AsrHostStatus>,
  onAsrStatus: (callback: (e: Electron.IpcRendererEvent, status: AsrHostStatus) => void) =>
    ipcRenderer.on('asr-status', callback),
  asrCapabilities: () => ipcRenderer.invoke('asr-capabilities') as Promise<LocalModelCapabilities>,
  asrOpenSession: (opts: AsrSessionOptions) =>
    ipcRenderer.invoke('asr-open-session', opts) as Promise<{ sessionId: string }>,
  asrPushAudio: (req: { sessionId: string; pcm: Uint8Array; endOfUtterance?: boolean }) =>
    ipcRenderer.invoke('asr-push-audio', req) as Promise<void>,
  asrCloseSession: (req: { sessionId: string }) =>
    ipcRenderer.invoke('asr-close-session', req) as Promise<void>,
  onWalWindowClosed: (
    callback: (e: Electron.IpcRendererEvent, info: { webContentsId: number }) => void,
  ) => ipcRenderer.on('wal-window-closed', callback),
  onAsrEvent: (callback: (e: Electron.IpcRendererEvent, event: AsrIncomingEvent) => void) =>
    ipcRenderer.on('asr-event', callback),
});

declare global {
  interface Window {
    electronAPI: unknown;
  }
}

// A grant's MessagePort arrives from main on this channel; it cannot be
// proxied through the context bridge, so it is re-posted into the page where
// the applet host forwards it to the requesting Tool.
ipcRenderer.on('audio-source-port', (event, payload: AudioSourcePortDelivery) => {
  window.postMessage({ type: 'audio-source-port', ...payload }, '*', event.ports);
});
