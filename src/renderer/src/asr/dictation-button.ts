// A microphone toggle that dictates into a text input owned by the parent.
// Each final transcript segment is dispatched as a `dictation-text` event;
// the parent decides what to do with it. The button hides itself while
// the Transcription switch is off or no model is available, and stops
// dictation when it leaves the DOM or is hidden. Group views stay mounted
// and are hidden with `display: none` when the user moves elsewhere, so
// visibility, not only disconnection, ends a dictation.

import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import { notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiMicrophone } from '@mdi/js';

import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import { mossStoreContext } from '../context.js';
import type { MossStore } from '../moss-store.js';
import { LOCAL_AI_ENABLED_CHANGED_EVENT } from '../persisted-store.js';
import { mossStyles } from '../shared-styles.js';
import { Dictation, type DictationState } from './dictation.js';
import { mossDictationAvailable, mossDictationHost } from './moss-dictation-host.js';

/** Fired once per final transcript segment; `detail` is the trimmed text. */
export const DICTATION_TEXT_EVENT = 'dictation-text';

declare global {
  interface HTMLElementEventMap {
    [DICTATION_TEXT_EVENT]: CustomEvent<string>;
  }
}

@localized()
@customElement('moss-dictation-button')
export class MossDictationButton extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @state() private available = false;
  @state() private dictationState: DictationState = 'idle';

  private dictation = new Dictation(mossDictationHost(), {
    onText: (text) =>
      this.dispatchEvent(
        new CustomEvent<string>(DICTATION_TEXT_EVENT, {
          detail: text,
          bubbles: true,
          composed: true,
        }),
      ),
    onError: (message) => notifyError(msg(str`Dictation stopped: ${message}`)),
    onStateChange: (s) => {
      this.dictationState = s;
    },
  });

  private onSwitchChanged = () => {
    void this.refreshAvailability();
  };

  private visibility = new IntersectionObserver((entries) => {
    if (entries.some((e) => !e.isIntersecting)) void this.dictation.stop();
  });

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener(LOCAL_AI_ENABLED_CHANGED_EVENT, this.onSwitchChanged);
    this.visibility.observe(this);
    void this.refreshAvailability();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(LOCAL_AI_ENABLED_CHANGED_EVENT, this.onSwitchChanged);
    this.visibility.disconnect();
    void this.dictation.stop();
  }

  private async refreshAvailability(): Promise<void> {
    this.available = await mossDictationAvailable(
      this.mossStore.persistedStore.localAiEnabled.value(),
    );
    if (!this.available) void this.dictation.stop();
  }

  private toggle(): void {
    if (this.dictationState === 'idle') void this.dictation.start();
    else void this.dictation.stop();
  }

  render() {
    if (!this.available) return html``;
    const active = this.dictationState === 'starting' || this.dictationState === 'listening';
    // After stop, the last audio is still being transcribed; its text
    // lands in the input when this state ends.
    const finishing = this.dictationState === 'stopping';
    const label = finishing
      ? msg('Finishing transcription')
      : active
        ? msg('Stop dictation')
        : msg('Dictate a message');
    return html`
      <button
        class="moss-button mic-button ${active ? 'listening' : ''} ${finishing ? 'finishing' : ''}"
        title=${label}
        aria-label=${label}
        aria-pressed=${active ? 'true' : 'false'}
        ?disabled=${finishing}
        @click=${() => this.toggle()}
      >
        ${finishing
          ? html`<sl-spinner></sl-spinner>`
          : html`<sl-icon .src=${wrapPathInSvg(mdiMicrophone)}></sl-icon>`}
      </button>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }
      .mic-button {
        padding: 0 9px;
        border-radius: 9px;
        font-size: 20px;
        display: flex;
        align-items: center;
      }
      .mic-button.finishing:disabled {
        opacity: 1;
        background: black;
      }
      .mic-button sl-spinner {
        font-size: 20px;
        --indicator-color: white;
        --track-color: rgba(255, 255, 255, 0.3);
      }
      .mic-button.listening {
        background: #c0392b;
        animation: pulse 1.4s ease-in-out infinite;
      }
      @keyframes pulse {
        50% {
          opacity: 0.6;
        }
      }
    `,
  ];
}
