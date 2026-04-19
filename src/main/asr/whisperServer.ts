// Wraps a single whisper-server child process. Owns its lifecycle
// (spawn → ready → transcribe → stop) and exposes a Promise-based
// transcribe() that POSTs WAV bytes over loopback HTTP.
//
// This is the lowest layer of the M1 ASR service. Higher layers
// (broker, sessions, VAD) compose on top of one or more WhisperServer
// instances.
//
// Lifecycle is single-use by design. Restart = new instance.
// The choice keeps state machine concerns out of the wrapper:
// the broker owns model lifecycle (lazy-load, idle-unload).

import { ChildProcessByStdio, spawn as spawnChild } from 'node:child_process';
import type { Readable } from 'node:stream';
import { createServer, Socket } from 'node:net';

import {
  AsrSegment,
  AsrTranscribeResult,
  WhisperServerConfig,
  WhisperServerState,
} from './types';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_THREADS = 4;
const DEFAULT_START_TIMEOUT_MS = 60_000;
const READY_PROBE_INTERVAL_MS = 100;

export class WhisperServerStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhisperServerStartError';
  }
}

export class WhisperServerStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhisperServerStateError';
  }
}

export class WhisperServerTranscribeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhisperServerTranscribeError';
  }
}

export class WhisperServer {
  private _state: WhisperServerState = 'idle';
  private proc: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private boundPort = 0;
  private readonly host: string;
  private readonly threads: number;
  private readonly startTimeoutMs: number;
  private readonly onLog: NonNullable<WhisperServerConfig['onLog']>;

  constructor(private readonly config: WhisperServerConfig) {
    if (config.command.length === 0) {
      throw new Error('WhisperServerConfig.command must not be empty');
    }
    this.host = config.host ?? DEFAULT_HOST;
    this.threads = config.threads ?? DEFAULT_THREADS;
    this.startTimeoutMs = config.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    this.onLog = config.onLog ?? (() => {});
  }

  get state(): WhisperServerState {
    return this._state;
  }

  /** The port the server is listening on. Only meaningful while ready. */
  get port(): number {
    return this.boundPort;
  }

  /** Loopback URL of the inference endpoint. Only meaningful while ready. */
  get inferenceUrl(): string {
    return `http://${this.host}:${this.boundPort}/inference`;
  }

  /**
   * Spawn whisper-server, wait until it accepts TCP connections.
   * Resolves once the server has bound its port; rejects on timeout
   * or early-exit. Safe to call exactly once per instance.
   */
  async start(): Promise<void> {
    if (this._state !== 'idle') {
      throw new WhisperServerStateError(
        `start() called in state ${this._state}; only valid from 'idle'`,
      );
    }
    this._state = 'starting';

    const port = this.config.port ?? (await pickFreePort());
    this.boundPort = port;

    const [cmd, ...leadingArgs] = this.config.command;
    const args = [
      ...leadingArgs,
      '-m', this.config.modelPath,
      '--host', this.host,
      '--port', String(port),
      '-t', String(this.threads),
    ];

    const proc = spawnChild(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.stdout.on('data', (b: Buffer) => this.onLog('stdout', b.toString('utf8')));
    proc.stderr.on('data', (b: Buffer) => this.onLog('stderr', b.toString('utf8')));

    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    proc.once('exit', (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      // If we exit during 'starting', the start() Promise will catch it
      // via the readiness loop. If we exit during 'ready', the next
      // transcribe() will fail (the server is gone). Either way, mark
      // ourselves as stopped so callers see consistent state.
      if (this._state === 'starting' || this._state === 'ready') {
        this._state = 'stopped';
      }
    });

    const deadline = Date.now() + this.startTimeoutMs;
    while (Date.now() < deadline) {
      if (exited) {
        throw new WhisperServerStartError(
          `whisper-server exited before becoming ready (code=${exitCode}, signal=${exitSignal})`,
        );
      }
      if (await canConnect(this.host, port)) {
        this._state = 'ready';
        return;
      }
      await sleep(READY_PROBE_INTERVAL_MS);
    }

    // Timed out waiting for readiness — kill the process and report.
    this._state = 'stopping';
    proc.kill('SIGKILL');
    this._state = 'stopped';
    throw new WhisperServerStartError(
      `whisper-server did not become ready within ${this.startTimeoutMs} ms`,
    );
  }

  /**
   * Send a WAV-encoded audio buffer to the running server, return the
   * parsed segments. Caller is responsible for the WAV format (PCM16,
   * mono, 16 kHz is what we feed; whisper-server resamples internally
   * but we minimize ambiguity by normalizing upstream).
   */
  async transcribe(wav: Buffer): Promise<AsrTranscribeResult> {
    if (this._state !== 'ready') {
      throw new WhisperServerStateError(
        `transcribe() called in state ${this._state}; server is not ready`,
      );
    }

    const boundary = `----moss-asr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
        `Content-Type: audio/wav\r\n\r\n`,
    );
    const tail = Buffer.from(
      `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n` +
        `--${boundary}--\r\n`,
    );
    const body = Buffer.concat([head, wav, tail]);

    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(this.inferenceUrl, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });
    } catch (err) {
      throw new WhisperServerTranscribeError(
        `inference request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const inferMs = Math.round(performance.now() - t0);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new WhisperServerTranscribeError(
        `inference HTTP ${res.status}: ${text.slice(0, 500)}`,
      );
    }

    const json = (await res.json()) as unknown;
    const segments = parseSegments(json);
    const lang = parseLang(json);
    return { segments, inferMs, lang };
  }

  /**
   * Send SIGTERM, wait briefly for graceful exit, then SIGKILL.
   * Idempotent: calling stop() on an already-stopped server is a no-op.
   */
  async stop(): Promise<void> {
    if (this._state === 'stopped' || this._state === 'idle') {
      this._state = 'stopped';
      return;
    }
    this._state = 'stopping';
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) {
      this._state = 'stopped';
      return;
    }

    const exited = new Promise<void>((resolve) => {
      proc.once('exit', () => resolve());
    });
    proc.kill('SIGTERM');
    const winner = await Promise.race([
      exited.then(() => 'graceful' as const),
      sleep(2_000).then(() => 'timeout' as const),
    ]);
    if (winner === 'timeout') {
      proc.kill('SIGKILL');
      await exited;
    }
    this._state = 'stopped';
  }
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error('could not pick a free port'));
      }
    });
  });
}

async function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = new Socket();
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      probe.destroy();
      resolve(ok);
    };
    probe.setTimeout(500);
    probe.once('error', () => finish(false));
    probe.once('timeout', () => finish(false));
    probe.connect(port, host, () => finish(true));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface RawSegment {
  text?: unknown;
  // whisper-server's verbose_json uses different fields across versions;
  // accept any of these.
  t0?: unknown;
  t1?: unknown;
  start?: unknown;
  end?: unknown;
  offsets?: { from?: unknown; to?: unknown };
}

function parseSegments(json: unknown): AsrSegment[] {
  if (!isObject(json)) return [];
  const raw = (json as { segments?: unknown }).segments;
  if (!Array.isArray(raw)) {
    // Older whisper-server may return a single { text } object.
    const text = (json as { text?: unknown }).text;
    if (typeof text === 'string') {
      return [{ text: text.trim(), tStart: 0, tEnd: 0 }];
    }
    return [];
  }
  return raw
    .map((s: unknown): AsrSegment | null => {
      if (!isObject(s)) return null;
      const seg = s as RawSegment;
      const text = typeof seg.text === 'string' ? seg.text.trim() : '';
      if (!text) return null;
      const { tStart, tEnd } = pickTimes(seg);
      return { text, tStart, tEnd };
    })
    .filter((s): s is AsrSegment => s !== null);
}

function pickTimes(seg: RawSegment): { tStart: number; tEnd: number } {
  // verbose_json layouts seen in the wild:
  //   1. { t0: ms, t1: ms, text }
  //   2. { offsets: { from: ms, to: ms }, text }
  //   3. { start: seconds, end: seconds, text }   (OpenAI-compatible)
  if (typeof seg.t0 === 'number' && typeof seg.t1 === 'number') {
    return { tStart: seg.t0, tEnd: seg.t1 };
  }
  if (seg.offsets && typeof seg.offsets.from === 'number' && typeof seg.offsets.to === 'number') {
    return { tStart: seg.offsets.from, tEnd: seg.offsets.to };
  }
  if (typeof seg.start === 'number' && typeof seg.end === 'number') {
    return { tStart: Math.round(seg.start * 1000), tEnd: Math.round(seg.end * 1000) };
  }
  return { tStart: 0, tEnd: 0 };
}

function parseLang(json: unknown): string | undefined {
  if (!isObject(json)) return undefined;
  const lang = (json as { language?: unknown }).language;
  return typeof lang === 'string' ? lang : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
