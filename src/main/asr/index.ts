// Public surface of the Moss-side ASR module. Higher layers in main
// (broker users, IPC handlers) import from here, not from individual
// files.
//
// The WeaveClient surface in @theweave/api is built on top of this in
// M2 and lives elsewhere — nothing here should be re-exported into the
// renderer or applet sandboxes directly.

export type {
  AsrSegment,
  AsrTranscribeResult,
  WhisperServerConfig,
  WhisperServerState,
} from './types';

export {
  WhisperServer,
  WhisperServerStartError,
  WhisperServerStateError,
  WhisperServerTranscribeError,
} from './whisperServer';

export type { AsrSessionOptions, AsrFinalEvent, AsrPartialEvent } from './session';
export { AsrSession, AsrSessionStateError } from './session';

export type { AsrBrokerConfig } from './broker';
export { AsrBroker } from './broker';

export { pcm16ToWav } from './wav';
export type { PcmShape } from './wav';

export {
  WHISPER_SERVER_ENV_VAR,
  WhisperCommandResolveError,
  resolveWhisperServerCommand,
  whisperServerBinaryName,
} from './binaryResolver';
export type {
  ResolveWhisperCommandOptions,
  ResolvedWhisperCommand,
  WhisperBinarySource,
} from './binaryResolver';

export {
  defaultModelPath,
  getAsrBroker,
  initAsrService,
  isAsrServiceInitialized,
  shutdownAsrService,
} from './asrService';
export type { AsrServiceConfig } from './asrService';

export { SessionRegistry } from './sessionRegistry';
export type { SessionEntry } from './sessionRegistry';

export {
  AsrIpcError,
  asrCloseAllForOwner,
  asrCloseSession,
  asrOpenSession,
  asrPushAudio,
} from './ipcHandlers';
export type {
  AsrCloseSessionRequest,
  AsrEventEmitter,
  AsrIpcEvent,
  AsrIpcHandlerContext,
  AsrOpenSessionRequest,
  AsrPushAudioRequest,
} from './ipcHandlers';

export { registerAsrIpc, isAsrIpcRegistered, WHISPER_SERVER_VERSION } from './wireUp';
export type { AsrWireUpConfig } from './wireUp';
