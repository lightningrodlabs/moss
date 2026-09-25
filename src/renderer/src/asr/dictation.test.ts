import { describe, expect, it, vi } from 'vitest';

import type { AsrIncomingEvent, AsrSessionOptions } from '@theweave/api';

import {
  appendTranscript,
  cleanTranscript,
  Dictation,
  type DictationHost,
  type DictationState,
  type MicCapture,
} from './dictation.js';

/** A microphone whose blocks the test feeds by hand. */
class FakeMic implements MicCapture {
  sampleRate = 48_000;
  stopped = false;
  private queue: Float32Array[] = [];
  private waiting: ((block: Float32Array | null) => void) | null = null;

  feed(block: Float32Array): void {
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w(block);
    } else this.queue.push(block);
  }

  read(): Promise<Float32Array | null> {
    if (this.stopped) return Promise.resolve(null);
    const next = this.queue.shift();
    if (next) return Promise.resolve(next);
    return new Promise((resolve) => (this.waiting = resolve));
  }

  stop(): void {
    this.stopped = true;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w(null);
    }
  }
}

function makeHost(mic = new FakeMic()) {
  const listeners = new Map<string, (ev: AsrIncomingEvent) => void>();
  const pushed: { sessionId: string; pcm: Uint8Array }[] = [];
  const opened: AsrSessionOptions[] = [];
  const host = {
    warmUp: vi.fn(async () => undefined),
    openMic: vi.fn(async (): Promise<MicCapture> => mic),
    openSession: vi.fn(async (opts: AsrSessionOptions) => {
      opened.push(opts);
      return { sessionId: `s${opened.length}` };
    }),
    pushAudio: vi.fn(async (req: { sessionId: string; pcm: Uint8Array }) => {
      pushed.push(req);
    }),
    closeSession: vi.fn(async (_req: { sessionId: string }): Promise<void> => undefined),
    registerListener: vi.fn((sessionId: string, l: (ev: AsrIncomingEvent) => void) => {
      listeners.set(sessionId, l);
    }),
    unregister: vi.fn((sessionId: string) => {
      listeners.delete(sessionId);
    }),
  } satisfies DictationHost;
  return { host, mic, listeners, pushed, opened };
}

function makeDictation(host: DictationHost) {
  const texts: string[] = [];
  const errors: string[] = [];
  const states: DictationState[] = [];
  const dictation = new Dictation(host, {
    onText: (t) => texts.push(t),
    onError: (e) => errors.push(e),
    onStateChange: (s) => states.push(s),
  });
  return { dictation, texts, errors, states };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Dictation.start', () => {
  it('warms up, opens a mono English session at the mic rate, and listens', async () => {
    const { host, opened, listeners } = makeHost();
    const { dictation, states } = makeDictation(host);
    await dictation.start();
    expect(host.warmUp).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([{ language: 'en', sampleRate: 48_000, channels: 1 }]);
    expect(listeners.has('s1')).toBe(true);
    expect(dictation.state).toBe('listening');
    expect(states).toEqual(['starting', 'listening']);
  });

  it('pushes microphone blocks to the session as PCM16 bytes', async () => {
    const { host, mic, pushed } = makeHost();
    const { dictation } = makeDictation(host);
    await dictation.start();
    mic.feed(new Float32Array([0, 1]));
    await flush();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].sessionId).toBe('s1');
    expect(pushed[0].pcm.byteLength).toBe(4);
  });

  it('is a no-op while already running', async () => {
    const { host } = makeHost();
    const { dictation } = makeDictation(host);
    await dictation.start();
    await dictation.start();
    expect(host.openSession).toHaveBeenCalledTimes(1);
  });

  it('reports a microphone failure and returns to idle', async () => {
    const { host } = makeHost();
    host.openMic.mockRejectedValueOnce(new Error('Permission denied'));
    const { dictation, errors } = makeDictation(host);
    await dictation.start();
    expect(errors).toEqual(['Permission denied']);
    expect(dictation.state).toBe('idle');
    expect(host.openSession).not.toHaveBeenCalled();
  });

  it('stops the microphone when the session cannot be opened', async () => {
    const { host, mic } = makeHost();
    host.openSession.mockRejectedValueOnce(new Error('no model'));
    const { dictation, errors } = makeDictation(host);
    await dictation.start();
    expect(errors).toEqual(['no model']);
    expect(mic.stopped).toBe(true);
    expect(dictation.state).toBe('idle');
  });

  it('does not fail when warm-up rejects', async () => {
    const { host } = makeHost();
    host.warmUp.mockRejectedValueOnce(new Error('cold'));
    const { dictation, errors } = makeDictation(host);
    await dictation.start();
    await flush();
    expect(errors).toEqual([]);
    expect(dictation.state).toBe('listening');
  });
});

describe('Dictation events', () => {
  it('reports final text, trimmed, and skips empty finals', async () => {
    const { host, listeners } = makeHost();
    const { dictation, texts } = makeDictation(host);
    await dictation.start();
    const emit = listeners.get('s1')!;
    emit({ sessionId: 's1', eventType: 'final', text: '  hello there ', tStart: 0, tEnd: 1 });
    emit({ sessionId: 's1', eventType: 'final', text: '   ', tStart: 1, tEnd: 2 });
    expect(texts).toEqual(['hello there']);
  });

  it('on an error event reports it, stops the microphone, and returns to idle', async () => {
    const { host, mic, listeners } = makeHost();
    const { dictation, errors } = makeDictation(host);
    await dictation.start();
    listeners.get('s1')!({ sessionId: 's1', eventType: 'error', error: 'server died' });
    expect(errors).toEqual(['server died']);
    expect(mic.stopped).toBe(true);
    expect(dictation.state).toBe('idle');
  });
});

describe('Dictation.stop', () => {
  it('stops the microphone, closes the session, then unregisters', async () => {
    const { host, mic } = makeHost();
    const order: string[] = [];
    host.closeSession.mockImplementation(async () => {
      order.push('close');
    });
    host.unregister.mockImplementation(() => {
      order.push('unregister');
    });
    const { dictation, states } = makeDictation(host);
    await dictation.start();
    await dictation.stop();
    expect(mic.stopped).toBe(true);
    expect(host.closeSession).toHaveBeenCalledWith({ sessionId: 's1' });
    expect(order).toEqual(['close', 'unregister']);
    expect(dictation.state).toBe('idle');
    expect(states).toEqual(['starting', 'listening', 'stopping', 'idle']);
  });

  it('still delivers a final that arrives while the session closes', async () => {
    const { host, listeners } = makeHost();
    const { dictation, texts } = makeDictation(host);
    host.closeSession.mockImplementation(async ({ sessionId }) => {
      listeners.get(sessionId)!({
        sessionId,
        eventType: 'final',
        text: 'last words',
        tStart: 0,
        tEnd: 1,
      });
    });
    await dictation.start();
    await dictation.stop();
    expect(texts).toEqual(['last words']);
  });

  it('cancels a start that has not opened the session yet', async () => {
    const { host, mic } = makeHost();
    let releaseMic!: () => void;
    host.openMic.mockImplementationOnce(
      () => new Promise<MicCapture>((resolve) => (releaseMic = () => resolve(mic))),
    );
    const { dictation } = makeDictation(host);
    const starting = dictation.start();
    await dictation.stop();
    expect(dictation.state).toBe('idle');
    releaseMic();
    await starting;
    expect(mic.stopped).toBe(true);
    expect(host.openSession).not.toHaveBeenCalled();
    expect(dictation.state).toBe('idle');
  });

  it('is a no-op when idle', async () => {
    const { host } = makeHost();
    const { dictation } = makeDictation(host);
    await dictation.stop();
    expect(host.closeSession).not.toHaveBeenCalled();
  });

  it('treats a rejected close as done', async () => {
    const { host } = makeHost();
    host.closeSession.mockRejectedValueOnce(new Error('already closed'));
    const { dictation, errors } = makeDictation(host);
    await dictation.start();
    await dictation.stop();
    expect(dictation.state).toBe('idle');
    expect(errors).toEqual([]);
    expect(host.unregister).toHaveBeenCalledWith('s1');
  });
});

describe('appendTranscript', () => {
  it('returns the text alone for an empty input', () => {
    expect(appendTranscript('', 'hello')).toBe('hello');
  });

  it('joins with one space', () => {
    expect(appendTranscript('hello', 'world')).toBe('hello world');
    expect(appendTranscript('hello ', 'world')).toBe('hello world');
  });
});

describe('cleanTranscript', () => {
  it('drops a segment that is only a non-speech marker', () => {
    for (const t of [
      '[BLANK_AUDIO]',
      ' [BLANK_AUDIO] ',
      '[ Silence ]',
      '(upbeat music)',
      '[MUSIC].',
    ]) {
      expect(cleanTranscript(t)).toBe('');
    }
  });

  it('removes markers inside spoken text and tidies spacing', () => {
    expect(cleanTranscript('hello [BLANK_AUDIO] there')).toBe('hello there');
    expect(cleanTranscript(' (coughs) Hello, world. ')).toBe('Hello, world.');
  });

  it('keeps ordinary text unchanged apart from trimming', () => {
    expect(cleanTranscript('  This is a question. ')).toBe('This is a question.');
  });
});

describe('Dictation marker filtering', () => {
  it('does not report a final that is only a marker', async () => {
    const { host, listeners } = makeHost();
    const { dictation, texts } = makeDictation(host);
    await dictation.start();
    const emit = listeners.get('s1')!;
    emit({ sessionId: 's1', eventType: 'final', text: '[BLANK_AUDIO]', tStart: 0, tEnd: 1 });
    emit({ sessionId: 's1', eventType: 'final', text: 'hi [BLANK_AUDIO]', tStart: 1, tEnd: 2 });
    expect(texts).toEqual(['hi']);
  });
});
