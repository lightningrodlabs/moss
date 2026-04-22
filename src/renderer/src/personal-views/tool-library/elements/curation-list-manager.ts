import {LitElement, html, css, PropertyValues} from "lit";
import {customElement, property, state} from "lit/decorators.js";
import {msg} from "@lit/localize";
import {ToolCurationConfig, ToolCurations} from "@theweave/moss-types";
import {mossStyles} from "../../../shared-styles";
import {trashIcon} from "../../../elements/_new_design/icons";
import {DEFAULT_PRODUCTION_TOOL_CURATION_CONFIGS} from "../tool-library-web2";

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

    if (this._urls.some((u) => u.url === this._normalizeUrl(this._newUrl.trim()))) {
      this._newUrl = "";
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
    this._urls = this._urls.filter((u) => u.id !== id);
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
            <sl-input
              id="inp-url"
              class="moss-input"
              type="url"
              placeholder="e.g. https://domain.com/mylist.json"
              .value=${this._newUrl}
              @input=${(e: InputEvent) => this._newUrl = (e.target as HTMLInputElement).value}
              @keydown=${this._onKeydown}
            />
          </div>

          <button class="moss-button" @click=${this._addUrl}>${msg('Add List')}</button>
        </div>
        ${this._error === "url"
                ? html`<span class="error-msg">${msg('Enter a valid URL')}</span>`
                : ""}
        <!-- List -->
        ${this._urls.length === 0
          ? html`<div class="empty-state">${msg('No lists found')}</div>`
          : html`
                ${this._urls.map(
                  (u) => {
                      const urlObj = new URL(u.url);
                      const domain = urlObj.hostname;
                      const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
                      return html`
                          <div style="display:flex; flex-direction:row; align-items:center; gap:8px;">
                            <a href="${u.url}" target="_blank" rel="noopener noreferrer" class="link-preview-card" style="flex-grow:1;">
                                <div class="link-preview-favicon">
                                    <img src="${favicon}" alt=""
                                         @error=${(e: Event) => (e.target as HTMLImageElement).style.display = 'none'}/>
                                </div>
                                <div class="link-preview-content">
                                    <div class="link-preview-domain">${u.name}</div>
                                    <div class="link-preview-url">${u.url}</div>
                                </div>
                            </a>
                            <sl-tooltip content=${msg("Remove curation list")} placement="left">
                                <button
                                        class="open-wal-button"
                                        @click=${() => this._removeUrl(u.id)}>
                                    ${trashIcon()}
                                </button>
                            </sl-tooltip>
                          </div>
                      `
                  })}
            `}
            <div style="margin-top:50px;">
                <div><b>${msg('Factory Reset')}</b></div>
                <div class="row items-center"
                     style="background: #ffaaaa; padding: 10px 15px; border-radius: 8px; margin-top: 12px;">
                    <span style="margin-right: 20px; flex: 1;">
                        ${msg('Fully reset list to initial setting')}
                    </span>
                    <sl-button
                            variant="danger"
                            @click=${async () => {
                                await this.initializeList(DEFAULT_PRODUCTION_TOOL_CURATION_CONFIGS.map((i) => i.url));
                                this.dispatchEvent(
                                        new CustomEvent("urls-changed", { detail: this._urls, bubbles: true })
                                );
                            }}
                    >
                        ${msg('Factory Reset')}
                    </sl-button>                    
                </div>
            </div>
      </div>
    `;
  }


  static styles = [
    mossStyles,
    css`
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
          margin-bottom: 30px;
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
        .link-preview-card {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 12px;
            padding: 12px;
            border-radius: 12px;
            background: var(--moss-main-green, #E0EED5);
            text-decoration: none;
            color: var(--moss-dark-button, #151A11);
            transition: background 0.2s ease;
            margin-top: 8px;
        }

        .link-preview-card:hover {
            background: color-mix(in srgb, var(--moss-main-green, #E0EED5) 80%, #000 10%);
        }

        .link-preview-favicon {
            width: 48px;
            height: 48px;
            border-radius: 8px;
            background: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            overflow: hidden;
        }

        .link-preview-favicon img {
            width: 32px;
            height: 32px;
            object-fit: contain;
        }

        .link-preview-content {
            display: flex;
            flex-direction: column;
            gap: 4px;
            overflow: hidden;
        }

        .link-preview-domain {
            font-size: 12px;
            font-weight: 500;
            color: var(--moss-dark-button, #151A11);
        }

        .link-preview-url {
            font-size: 11px;
            color: rgba(21, 26, 17, 0.6);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .open-wal-button {
            background: #fff;
            color: var(--moss-dark-button);
            cursor: pointer;
            display: flex;
            padding: 8px 10px;
            justify-content: center;
            align-items: center;
            gap: 10px;
            border-radius: 8px;
            border: none;
            transition: background 0.1s ease, color 0.1s ease;
        }

        .open-wal-button:hover {
            background: var(--moss-dark-button);
            color: #fff;
        }
        

    `];
}
