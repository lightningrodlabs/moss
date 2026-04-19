// <asr-test> — exercises Moss's local ASR pipeline from inside an applet,
// the same way every other capability is exposed for testing in this
// example applet. Two paths:
//
//   1. "Open + close session" smoke test (no audio). Verifies that
//      WeaveClient → applet-iframe → renderer → main → broker round-
//      trips end-to-end and that idle session cleanup works.
//   2. Mic capture: getUserMedia → MediaStreamTrackProcessor pump →
//      Float32 → Int16 → AsrSession.pushAudio. Displays final
//      transcripts as they arrive. Tap "Stop" to mark end-of-utterance
//      and trigger a commit.
//
// This is deliberately bare-bones — no styling polish, no error
// recovery beyond surfacing the exception text. Pattern for a real
// applet is the same shape.

import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import {
  AsrFinalEvent,
  AsrSession,
  WeaveClient,
} from '@theweave/api';

interface TranscriptLine {
  text: string;
  tStart: number;
  tEnd: number;
  ts: number;
}

@localized()
@customElement('asr-test')
export class AsrTest extends LitElement {
  @property()
  weaveClient!: WeaveClient;

  @state() private session: AsrSession | null = null;
  @state() private sessionId: string | null = null;
  @state() private transcript: TranscriptLine[] = [];
  @state() private status: string = 'idle';
  @state() private capturing: boolean = false;
  @state() private lastError: string | null = null;

  private mediaStream: MediaStream | null = null;
  private trackReader: ReadableStreamDefaultReader<AudioData> | null = null;
  private nativeRate: number = 16_000;

  get available(): boolean {
    return !!this.weaveClient?.localModels?.asr;
  }

  // ── Smoke test: open + close ───────────────────────────────────
  async runSmokeTest() {
    this.lastError = null;
    this.status = 'opening';
    try {
      const session = await this.weaveClient.localModels!.asr.openSession({
        language: 'en',
      });
      this.status = `opened sessionId=${session.sessionId}; closing…`;
      await session.close();
      this.status = `smoke OK (sessionId was ${session.sessionId})`;
    } catch (e) {
      this.lastError = (e as Error).message;
      this.status = 'failed';
    }
  }

  // ── Mic capture path ───────────────────────────────────────────
  async startMicCapture() {
    if (this.capturing) return;
    this.lastError = null;
    this.transcript = [];
    try {
      if (!('MediaStreamTrackProcessor' in window)) {
        throw new Error('MediaStreamTrackProcessor not available in this browser');
      }
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const track = this.mediaStream.getAudioTracks()[0];
      const settings = track.getSettings();
      this.nativeRate = settings.sampleRate ?? 48_000;
      this.status = `capturing @ ${this.nativeRate} Hz`;

      this.session = await this.weaveClient.localModels!.asr.openSession({
        language: 'en',
        sampleRate: this.nativeRate,
        channels: 1,
      });
      this.sessionId = this.session.sessionId;
      this.session.onFinal((ev: AsrFinalEvent) => this.onFinal(ev));
      this.session.onError((err: Error) => {
        this.lastError = err.message;
      });

      const Processor = (
        window as unknown as {
          MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => {
            readable: ReadableStream<AudioData>;
          };
        }
      ).MediaStreamTrackProcessor;
      const processor = new Processor({ track });
      this.trackReader = processor.readable.getReader();
      this.capturing = true;
      void this.pumpLoop();
    } catch (e) {
      this.lastError = (e as Error).message;
      this.status = 'mic start failed';
      this.capturing = false;
      await this.teardownStream();
    }
  }

  async stopMicCapture(commit: boolean = true) {
    if (!this.capturing) return;
    this.capturing = false;
    try {
      // Stop pumping first so no more pushAudio calls land after close.
      if (this.trackReader) {
        try {
          await this.trackReader.cancel();
        } catch {
          /* the reader is gone if pump already exited */
        }
        this.trackReader = null;
      }
      await this.teardownStream();

      if (this.session) {
        if (commit) {
          // Force a final commit on whatever's buffered.
          await this.session.pushAudio(new Int16Array(0), true);
        }
        await this.session.close();
      }
    } catch (e) {
      this.lastError = (e as Error).message;
    } finally {
      this.session = null;
      this.sessionId = null;
      this.status = 'stopped';
    }
  }

  private async teardownStream() {
    if (this.mediaStream) {
      for (const t of this.mediaStream.getTracks()) t.stop();
      this.mediaStream = null;
    }
  }

  private async pumpLoop() {
    if (!this.trackReader || !this.session) return;
    try {
      while (this.capturing) {
        const { done, value } = await this.trackReader.read();
        if (done || !value) break;
        // value is an AudioData; copy plane 0 as Float32, convert to
        // Int16. We send PCM at native sample rate; Moss-side broker
        // reads sampleRate from the session opts and includes it in
        // the WAV header so whisper-server resamples internally.
        const frames = value.numberOfFrames;
        const f32 = new Float32Array(frames);
        try {
          value.copyTo(f32, { planeIndex: 0, format: 'f32-planar' });
        } catch {
          value.copyTo(f32, { planeIndex: 0 });
        }
        value.close();
        const int16 = floatToInt16(f32);
        await this.session.pushAudio(int16, false);
      }
    } catch (e) {
      this.lastError = (e as Error).message;
      // pumpLoop ending while capturing=true means an exception broke
      // out; stop cleanly so the UI button state reflects reality.
      if (this.capturing) {
        await this.stopMicCapture(false);
      }
    }
  }

  private onFinal(ev: AsrFinalEvent) {
    this.transcript = [
      ...this.transcript,
      { text: ev.text, tStart: ev.tStart, tEnd: ev.tEnd, ts: Date.now() },
    ];
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    void this.stopMicCapture(false);
  }

  render() {
    if (!this.available) {
      return html`
        <div class="warn">
          <b>weaveClient.localModels?.asr is undefined.</b>
          The host has no ASR surface. Run Moss with the ASR feature
          enabled (it should be on by default in dev — check the main
          process logs for sidecar startup messages).
        </div>
      `;
    }

    return html`
      <div class="column">
        <div><b>Smoke test (no audio):</b></div>
        <button @click=${() => this.runSmokeTest()}>
          Open + close session
        </button>
        <div class="status">status: ${this.status}</div>

        <hr />

        <div><b>Microphone capture:</b></div>
        <div class="row">
          <button
            @click=${() => this.startMicCapture()}
            ?disabled=${this.capturing}
          >
            Start mic
          </button>
          <button
            @click=${() => this.stopMicCapture(true)}
            ?disabled=${!this.capturing}
          >
            Stop &amp; commit
          </button>
        </div>
        <div class="status">
          ${this.capturing
            ? html`capturing — sessionId=${this.sessionId} @ ${this.nativeRate} Hz`
            : html`not capturing`}
        </div>

        ${this.lastError
          ? html`<div class="error">error: ${this.lastError}</div>`
          : ''}

        <div class="transcript">
          ${this.transcript.length === 0
            ? html`<i>No final transcripts yet.</i>`
            : this.transcript.map(
                (line) => html`
                  <div class="line">
                    <span class="t"
                      >[${(line.tStart / 1000).toFixed(2)}s
                      → ${(line.tEnd / 1000).toFixed(2)}s]</span
                    >
                    ${line.text}
                  </div>
                `,
              )}
        </div>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
      }
      .column {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-width: 600px;
      }
      .row {
        display: flex;
        gap: 8px;
      }
      .status {
        font-family: monospace;
        font-size: 0.9em;
        color: #555;
      }
      .error {
        color: #b00;
        font-family: monospace;
      }
      .warn {
        background: #fff3cd;
        border: 1px solid #ffeeba;
        padding: 8px;
        border-radius: 4px;
      }
      .transcript {
        margin-top: 8px;
        padding: 8px;
        background: #f5f5f5;
        border-radius: 4px;
        max-height: 240px;
        overflow-y: auto;
        font-family: monospace;
        font-size: 0.9em;
      }
      .transcript .line {
        margin: 2px 0;
      }
      .transcript .t {
        color: #888;
        margin-right: 6px;
      }
      hr {
        width: 100%;
        border: none;
        border-top: 1px solid #ddd;
      }
    `,
  ];
}

function floatToInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}
