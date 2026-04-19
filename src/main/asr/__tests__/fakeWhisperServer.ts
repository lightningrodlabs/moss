// Test double for WhisperServer. Implements the public surface used
// by AsrSession + AsrBroker (state, start, transcribe, stop) without
// spawning a real subprocess. Lets unit tests drive the state machine
// deterministically and inject canned segments / failures.
//
// This file intentionally lives under __tests__/ so it never ships in
// the main bundle even if some refactor accidentally re-exports it.

import { AsrTranscribeResult, WhisperServerConfig, WhisperServerState } from '../types';
import type { WhisperServer } from '../whisperServer';

export interface FakeServerOptions {
  /** Delay (ms) before start() resolves. Lets tests exercise concurrent acquire(). */
  startDelayMs?: number;
  /** Make start() reject with this error after the delay. */
  failStartWith?: Error;
  /** Function run on each transcribe(); return canned results or throw. */
  transcribe?: (wav: Buffer) => AsrTranscribeResult;
}

export class FakeWhisperServer {
  state: WhisperServerState = 'idle';
  port = 0;
  inferenceUrl = 'http://fake/inference';
  startCalls = 0;
  stopCalls = 0;
  transcribeCalls: Buffer[] = [];

  constructor(
    public readonly config: WhisperServerConfig,
    private readonly opts: FakeServerOptions = {},
  ) {}

  async start(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`fake start in state ${this.state}`);
    }
    this.state = 'starting';
    this.startCalls += 1;
    if (this.opts.startDelayMs) {
      await new Promise((r) => setTimeout(r, this.opts.startDelayMs));
    }
    if (this.opts.failStartWith) {
      this.state = 'stopped';
      throw this.opts.failStartWith;
    }
    this.port = 65000;
    this.state = 'ready';
  }

  async transcribe(wav: Buffer): Promise<AsrTranscribeResult> {
    if (this.state !== 'ready') {
      throw new Error(`fake transcribe in state ${this.state}`);
    }
    this.transcribeCalls.push(wav);
    if (this.opts.transcribe) {
      return this.opts.transcribe(wav);
    }
    return {
      segments: [{ text: `(fake transcript ${this.transcribeCalls.length})`, tStart: 0, tEnd: 0 }],
      inferMs: 1,
    };
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'idle') {
      this.state = 'stopped';
      return;
    }
    this.state = 'stopping';
    this.stopCalls += 1;
    this.state = 'stopped';
  }
}

/** Cast helper. Broker / Session only touch the methods the fake provides. */
export function asWhisperServer(fake: FakeWhisperServer): WhisperServer {
  return fake as unknown as WhisperServer;
}
