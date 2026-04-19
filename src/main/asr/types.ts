// Internal types for the Moss-side ASR broker. These are NOT the
// public WeaveClient surface — that comes in M2. These are the shapes
// the broker, sidecar wrapper, and IPC layer pass between themselves.

export interface AsrSegment {
  /** Transcribed text for this segment. Trimmed. */
  text: string;
  /** Start of the segment in milliseconds, relative to the audio fed in. */
  tStart: number;
  /** End of the segment in milliseconds, relative to the audio fed in. */
  tEnd: number;
  /** 0.0–1.0 confidence if the runtime exposes it; else undefined. */
  confidence?: number;
}

export interface AsrTranscribeResult {
  segments: AsrSegment[];
  /** Wall-clock time spent inside the runtime for this call, in ms. */
  inferMs: number;
  /** Detected language (ISO 639-1) when auto-detect was used; else undefined. */
  lang?: string;
}

/**
 * Spawn config for a single whisper-server process. Callers control
 * the binary location so the same wrapper works against:
 *   - a packaged binary in `resources/bins/whisper-server-*`
 *   - a `nix shell` wrapper (dev / spike)
 *   - any other invocation that ends up running whisper-server
 */
export interface WhisperServerConfig {
  /**
   * The argv-zero (and optional leading args) that launches the whisper
   * server. e.g. `['whisper-server']` for a binary on PATH, or
   * `['nix', 'shell', 'nixpkgs#whisper-cpp', '-c', 'whisper-server']`
   * to run via nix in dev. Required because Moss has no global default
   * for "where is whisper-server"; the broker resolves this from
   * settings + bundled binaries.
   */
  command: readonly string[];

  /** Absolute path to a ggml model file (.bin). */
  modelPath: string;

  /** Loopback host to bind. Defaults to 127.0.0.1. */
  host?: string;

  /** Port to bind. If omitted, the OS picks a free one (recommended). */
  port?: number;

  /** Threads passed to whisper-server's `-t` flag. Default 4. */
  threads?: number;

  /**
   * How long to wait for the server to accept a TCP connection after
   * spawn before giving up. Defaults to 60_000 ms. Big models on cold
   * cache may need most of this.
   */
  startTimeoutMs?: number;

  /**
   * Optional log sink for the server's stdout/stderr. By default,
   * output is discarded; pass a function to inspect or pipe it
   * (Moss's main-process logger lives in src/main/logs.ts).
   */
  onLog?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

/**
 * Lifecycle states the wrapper transitions through. Linear; no going
 * back. A WhisperServer instance is single-use — call `start()`,
 * `transcribe()` as needed, then `stop()`. To restart, make a new
 * instance.
 */
export type WhisperServerState = 'idle' | 'starting' | 'ready' | 'stopping' | 'stopped';
