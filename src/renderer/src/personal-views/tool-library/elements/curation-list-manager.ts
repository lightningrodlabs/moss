import {LitElement, html, css, PropertyValues} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {msg} from "@lit/localize";
import {ToolCurationConfig, ToolCurations} from "@theweave/moss-types";

export interface NamedUrl {
  id: string;
  name: string;
  url: string;
  curUrl?: string;
}

@customElement("curation-list-manager")
export class UrlListManager extends LitElement {

  @property({type: Array})
  initialConfig: ToolCurationConfig[] = [];

  @state() private _urls: NamedUrl[] = [];

  @state() private _newUrl = "";
  @state() private _error = "";
  @state() private _removing: string | null = null;


  /** */
  protected firstUpdated(_changedProperties: PropertyValues) {
    super.firstUpdated(_changedProperties);
    /*await*/ this.initializeList(this.initialConfig.map((i) => i.url));
  }


  /** */
  async initializeList(urls: string[]) {
    this._urls = [];
    for (const cur of urls) {
      try {
        const url = cur.startsWith("http")
            ? cur
            : `https://${cur}`;
        const resp = await fetch(new URL(url), { cache: 'no-cache' });
        const toolCurations: ToolCurations = await resp.json();
        // TODO validate format strictly here
        //console.debug("<curation-list-manager> adding url", url);
        this._urls.push({url: this._normalizeUrl(url), id: this._generateId(), name: toolCurations.curator.name, curUrl: toolCurations.curator.contact.website});
      } catch {
        console.error("Failed to fetch curation list from url", cur);
      }
    }
    this.requestUpdate();
  }

  /** */
  private _generateId(): string {
    return Math.random().toString(36).slice(2, 7);
  }


  /** */
  private _normalizeUrl(raw: string): string {
    return raw.startsWith("http") ? raw : `https://${raw}`;
  }


  /** */
  private async _addUrl() {
    this._error = "";

    if (!this._newUrl.trim()) {
      this._error = "url";
      return;
    }
    let toolCurations: ToolCurations;
    try {
      const url = new URL(
        this._newUrl.startsWith("http")
          ? this._newUrl
          : `https://${this._newUrl}`
      );
      const resp = await fetch(url, { cache: 'no-cache' });
      toolCurations = await resp.json();
      console.log("Curation list found. Curator:", toolCurations.curator.name)
      // TODO validate format strictly here
    } catch {
      this._error = "url";
      return;
    }

    const entry: NamedUrl = {
      id: this._generateId(),
      name: toolCurations.curator.name,
      url: this._normalizeUrl(this._newUrl.trim()),
      curUrl: toolCurations.curator.contact.website,
    };

    this._urls = [...this._urls, entry];
    this._newUrl = "";

    this.dispatchEvent(
      new CustomEvent("urls-changed", { detail: this._urls, bubbles: true })
    );
  }


  /** */
  private async _removeUrl(id: string) {
    this._removing = id;
    await new Promise((r) => setTimeout(r, 280)); // waits 280ms for the animation to finish
    this._urls = this._urls.filter((u) => u.id !== id);
    this._removing = null;
    this.dispatchEvent(
      new CustomEvent("urls-changed", { detail: this._urls, bubbles: true })
    );
  }

  /** */
  private _onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") /*await*/ this._addUrl();
  }


  /** */
  render() {
    //console.debug("<curation-list-manager> render", this._urls);
    return html`
        <div class="container">
        <div class="add-form">
          <div class="field ${this._error === "url" ? "error" : ""}">
            <label for="inp-url">URL</label>
            <input
              id="inp-url"
              type="url"
              placeholder="e.g. https://domain.com/mylist.json"
              .value=${this._newUrl}
              @input=${(e: InputEvent) => this._newUrl = (e.target as HTMLInputElement).value}
              @keydown=${this._onKeydown}
            />
          </div>

          <button class="btn-add" @click=${this._addUrl}>${msg('Add List')}</button>
        </div>
        ${this._error === "url"
                ? html`<span class="error-msg">${msg('Enter a valid URL')}</span>`
                : ""}
        <!-- List -->
        ${this._urls.length === 0
          ? html`<div class="empty-state">${msg('No lists found')}</div>`
          : html`
              <ul>
                ${this._urls.map(
                  (u) => html`
                    <li class="${this._removing === u.id ? "removing" : ""}">
                      <div class="url-info">
                        <div class="url-name">
                            <a class="url-name"
                               href=${u.curUrl}
                               target="_blank"
                               rel="noopener noreferrer"
                            >${u.name}</a>
                        </div>
                        <a
                          class="url-href"
                          href=${u.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          >${u.url}</a>
                      </div>
                      <button
                        class="btn-remove"
                        title="${msg("Remove curation list from")} ${u.name}"
                        @click=${() => this._removeUrl(u.id)}
                      >
                        ✕
                      </button>
                    </li>
                  `
                )}
              </ul>
            `}
      </div>
    `;
  }


  static styles = css`
      :host {
          display: block;
          padding: 3rem 2rem;
          box-sizing: border-box;
      }

      .publish-dialog {
          padding: 20px;
          border-radius: 20px;
          line-height: 1.2;
      }

      .container {
          max-width: 880px;
          margin: 0 auto;
      }


      /* ── Add form ── */

      .add-form {
          display: flex;
          flex-direction: row;
          gap: 10px;
      }

      .field {
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          flex-grow: 1;
      }

      label {
          font-size: 0.7rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #5a5550;
      }

      input {
          background: #f3f1f1;
          border: 1px solid #2a2a2a;
          color: #1e1e1e;
          font-size: 0.9rem;
          padding: 0.65rem 0.85rem;
          outline: none;
          transition: border-color 0.2s;
          width: 100%;
          box-sizing: border-box;
      }

      input::placeholder {
          color: #858381;
      }

      input:focus {
          border-color: #c8a96e;
      }

      .error input {
          border-color: #8b3a3a;
      }

      .error-msg {
          font-size: 0.72rem;
          color: #8b3a3a;
          margin-top: 0.25rem;
          letter-spacing: 0.03em;
      }

      .btn-add {
          background: #c8a96e;
          border: none;
          color: #0d0d0d;
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          padding: 0 1.4rem;
          height: 2.5rem;
          cursor: pointer;
          align-self: end;
          transition: background 0.2s, transform 0.1s;
          white-space: nowrap;
      }

      .btn-add:hover {
          background: #d9bb80;
      }

      .btn-add:active {
          transform: scale(0.97);
      }

      /* ── URL list ── */

      .list-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 0.75rem;
      }

      .empty-state {
          text-align: center;
          padding: 3rem 0;
          color: #3a3530;
          font-size: 0.9rem;
          border: 1px dashed #2a2a2a;
          letter-spacing: 0.04em;
          margin-top: 40px;

      }

      ul {
          list-style: none;
          margin: 0;
          margin-top: 40px;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
      }

      li {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: 1rem;
          background: #f6f5f5;
          border: 1px solid #1e1e1e;
          padding: 0.85rem 1rem;
          transition: border-color 0.2s, opacity 0.3s, transform 0.3s;
      }

      li:hover {
          border-color: #2a2a2a;
      }

      li.removing {
          opacity: 0;
          transform: translateX(12px);
      }

      .url-info {
          min-width: 0;
      }

      .url-name {
          font-size: 0.95rem;
          color: #248b1e;
          margin-bottom: 0.2rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-decoration: none;
      }
      .url-name:hover {
          color: #c8a96e;
      }

      .url-href {
          font-size: 0.78rem;
          color: #5a5550;
          text-decoration: none;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: block;
          transition: color 0.15s;
      }

      .url-href:hover {
          color: #c8a96e;
      }

      .btn-remove {
          background: transparent;
          border: 1px solid #2a2a2a;
          color: #4a4540;
          font-size: 0.95rem;
          width: 2rem;
          height: 2rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: border-color 0.2s, color 0.2s, background 0.2s;
          flex-shrink: 0;
          line-height: 1;
      }

      .btn-remove:hover {
          border-color: #8b3a3a;
          color: #c04040;
          background: #1a0d0d;
      }

  `;
}
