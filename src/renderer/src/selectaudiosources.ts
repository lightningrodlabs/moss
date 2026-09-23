import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { AudioSourceRow } from '@theweave/moss-types';
import { mossStyles } from './shared-styles';
import '@shoelace-style/shoelace/dist/components/checkbox/checkbox.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

type PickerApi = {
  getAudioSourceRows: () => Promise<AudioSourceRow[]>;
  audioSourcesSelected: (ids: string[] | null) => Promise<void>;
};

const api = () => (window as unknown as { electronAPI: PickerApi }).electronAPI;

/**
 * The audio-source picker: the user ticks "All system output" and/or
 * individual applications. Rows arrive already ordered (playing apps first).
 */
@customElement('select-audio-sources')
export class SelectAudioSources extends LitElement {
  @state() _rows: AudioSourceRow[] = [];
  @state() _chosen = new Set<string>();

  async firstUpdated() {
    this._rows = await api().getAudioSourceRows();
  }

  private toggle(id: string, checked: boolean) {
    const next = new Set(this._chosen);
    if (checked) next.add(id);
    else next.delete(id);
    this._chosen = next;
  }

  private renderRow(row: AudioSourceRow) {
    const status =
      row.kind === 'system' ? '' : row.playing === true ? 'playing' : row.playing === false ? 'silent' : '';
    return html`
      <label class="row source-row">
        <sl-checkbox
          .checked=${this._chosen.has(row.id)}
          @sl-change=${(e: Event) => this.toggle(row.id, (e.target as HTMLInputElement).checked)}
        ></sl-checkbox>
        <span class="name">${row.name}</span>
        <span class="status ${status}">${status}</span>
      </label>
    `;
  }

  render() {
    const apps = this._rows.filter((r) => r.kind === 'app');
    return html`
      <div class="column" style="padding: 20px; gap: 12px;">
        <h2 style="margin: 0;">Share audio from</h2>
        ${this._rows.filter((r) => r.kind === 'system').map((r) => this.renderRow(r))}
        <div class="divider"></div>
        ${apps.length === 0
          ? html`<div class="empty">No applications with audio output were found.</div>`
          : apps.map((r) => this.renderRow(r))}
        <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 12px;">
          <sl-button @click=${() => api().audioSourcesSelected(null)}>Cancel</sl-button>
          <sl-button
            variant="primary"
            ?disabled=${this._chosen.size === 0}
            @click=${() => api().audioSourcesSelected([...this._chosen])}
            >Share</sl-button
          >
        </div>
      </div>
    `;
  }

  static get styles() {
    return [
      mossStyles,
      css`
        .source-row {
          align-items: center;
          gap: 10px;
          padding: 6px 8px;
          border-radius: 6px;
          cursor: pointer;
        }
        .source-row:hover {
          background: rgba(255, 255, 255, 0.4);
        }
        .name {
          flex: 1;
        }
        .status {
          font-size: 12px;
          opacity: 0.7;
        }
        .status.playing {
          color: #1a7f37;
          opacity: 1;
        }
        .divider {
          height: 1px;
          background: rgba(0, 0, 0, 0.2);
        }
        .empty {
          opacity: 0.7;
          font-size: 14px;
        }
      `,
    ];
  }
}
