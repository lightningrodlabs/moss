// The speech-model table under Settings > Services > Transcription. Dumb
// by design: it renders what it is given and asks its host to act, so the
// host owns IPC, confirmation and refresh.

import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';

import type { AsrModelDownloadProgress, AsrModelListEntry } from '@theweave/moss-types';
import { mossStyles } from '../../../shared-styles.js';
import { serviceStyles } from './service-styles.js';
import { formatModelSize, isEnglishOnly, modelRowState } from './model-row-state.js';

export type AsrModelListAction =
  | 'model-download'
  | 'model-cancel'
  | 'model-delete'
  | 'model-select';

@localized()
@customElement('asr-model-list')
export class AsrModelList extends LitElement {
  @property({ attribute: false }) models: AsrModelListEntry[] = [];
  @property({ attribute: false }) progress: ReadonlyMap<string, AsrModelDownloadProgress> =
    new Map();
  @property({ attribute: false }) errors: ReadonlyMap<string, string> = new Map();

  private act(action: AsrModelListAction, id: string): void {
    this.dispatchEvent(
      new CustomEvent<{ id: string }>(action, { detail: { id }, bubbles: true, composed: true }),
    );
  }

  private renderControls(entry: AsrModelListEntry) {
    const state = modelRowState(entry, this.progress.get(entry.id));
    switch (state.kind) {
      case 'download':
        return html`<sl-button size="small" @click=${() => this.act('model-download', entry.id)}
          >${msg('Download')}</sl-button
        >`;
      case 'resume':
        return html`
          <sl-button size="small" @click=${() => this.act('model-download', entry.id)}
            >${msg('Resume')}</sl-button
          >
          <sl-button size="small" @click=${() => this.act('model-delete', entry.id)}
            >${msg('Delete')}</sl-button
          >
        `;
      case 'downloading':
        return html`
          <sl-progress-bar value=${state.percent}>${state.percent}%</sl-progress-bar>
          <sl-button size="small" @click=${() => this.act('model-cancel', entry.id)}
            >${msg('Cancel')}</sl-button
          >
        `;
      case 'installed':
        return html`
          <sl-button
            size="small"
            variant="primary"
            @click=${() => this.act('model-select', entry.id)}
            >${msg('Use')}</sl-button
          >
          ${state.deletable
            ? html`<sl-button size="small" @click=${() => this.act('model-delete', entry.id)}
                >${msg('Delete')}</sl-button
              >`
            : nothing}
        `;
      case 'active':
        return html`
          <span class="active-badge">${msg('Active')}</span>
          ${state.deletable
            ? html`<sl-button size="small" @click=${() => this.act('model-delete', entry.id)}
                >${msg('Delete')}</sl-button
              >`
            : nothing}
        `;
    }
  }

  render() {
    return html`
      <div class="service-listbox">
        ${this.models.map((entry) => {
          const error = this.errors.get(entry.id);
          return html`
            <div class="service-line">
              <span class="service-line-name"
                >${entry.id}${entry.bundled ? html` · ${msg('Bundled')}` : nothing}</span
              >
              ${error
                ? html`<span class="service-line-meta service-error" title=${error}>${error}</span>`
                : html`<span class="service-line-meta">
                    ${formatModelSize(entry.sizeBytes)} ·
                    ${isEnglishOnly(entry.languages) ? msg('English only') : msg('Multilingual')}
                  </span>`}
              <div class="row controls">${this.renderControls(entry)}</div>
            </div>
          `;
        })}
      </div>
    `;
  }

  static styles = [
    mossStyles,
    serviceStyles,
    css`
      :host {
        display: block;
      }
      .controls {
        align-items: center;
        gap: 8px;
      }
      sl-progress-bar {
        width: 140px;
        --height: 16px;
      }
      .active-badge {
        font-size: 12px;
        font-weight: 600;
        color: var(--moss-purple, #6200ea);
      }
      .service-error {
        font-family: inherit;
        opacity: 1;
      }
    `,
  ];
}
