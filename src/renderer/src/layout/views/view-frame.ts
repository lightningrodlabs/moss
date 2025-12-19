import { css, html, LitElement, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { encodeHashToBase64 } from '@holochain/client';
import { consume } from '@lit/context';
import { IframeKind, intoOrigin, RenderView } from '@theweave/api';

import { mossStyles } from '../../shared-styles.js';
import { renderViewToQueryString } from '../../utils.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import { encode } from '@msgpack/msgpack';
import { fromUint8Array } from 'js-base64';

@localized()
@customElement('view-frame')
export class ViewFrame extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  mossStore!: MossStore;

  @property()
  renderView!: RenderView;

  @property()
  iframeKind!: IframeKind;

  @property()
  reloading = false;

  @state()
  appletDevPort: number | undefined;

  @state()
  loading = true;

  @state()
  slowLoading = false;

  @state()
  slowReloadTimeout: number | undefined;

  async firstUpdated() {
    if (this.mossStore.isAppletDev) {
      this.appletDevPort = await this.mossStore.getAppletDevPort(this.iframeKind);
    }
  }

  willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('reloading')) {
      if (this.reloading) {
        // If it takes longer than 5 seconds to unload, offer to hard reload
        this.slowReloadTimeout = window.setTimeout(() => {
          if (this.reloading) {
            this.slowLoading = true;
          }
        }, 4500);
        this.loading = true;
      } else {
        if (this.slowReloadTimeout) window.clearTimeout(this.slowReloadTimeout);
        this.loading = false;
        this.slowLoading = false;
      }
    }
  }

  hardRefresh() {
    this.slowLoading = false;
    this.dispatchEvent(new CustomEvent('hard-refresh', { bubbles: true, composed: true }));
  }

  renderLoading() {
    return html`
      <div
        class="column center-content"
        style="flex: 1; padding: 0; margin: 0; ${this.loading ? '' : 'display: none'}"
      >
        <img src="loading_animation.svg" />
        <div style="margin-left: 10px; font-size: 18px; color: #142510">
          ${this.reloading ? msg('reloading...') : msg('loading...')}
        </div>
        ${this.slowLoading
          ? html`
              <div class="column items-center" style="margin-top: 50px; max-width: 600px;">
                <div>This Tool takes unusually long to reload. Do you want to force reload?</div>
                <div style="margin-top: 10px; margin-bottom: 20px;">
                  (<b>Warning:</b> Force reloading may interrupt the Tool from saving unsaved
                  content)
                </div>
                <button
                  class="moss-button"
                  @click=${() => this.hardRefresh()}
                  style="margin-top: 20px; width: 150px;"
                >
                  Force Reload
                </button>
              </div>
            `
          : html``}
      </div>
    `;
  }

  renderIframe(src: string) {
    console.debug("<view-frame> iframeSrc = ", src);
    return html`
      <iframe
        frameborder="0"
        title="TODO"
        .id=${this.renderView.type === 'applet-view' &&
        this.renderView.view.type === 'main' &&
        this.iframeKind.type === 'applet'
          ? encodeHashToBase64(this.iframeKind.appletHash)
          : this.renderView.type}
        .src=${src}
        style="flex: 1; display: ${this.loading ? 'none' : 'block'}; padding: 0; margin: 0;"
        allow="camera *; microphone *; clipboard-write *;"
        @load=${() => this.loading = false}
      ></iframe>
      ${this.renderLoading()}
    `;
  }

  render() {
    if (this.mossStore.isAppletDev && this.appletDevPort) {
        const iframeSrc = `http://localhost:${this.appletDevPort}?${renderViewToQueryString(this.renderView)}#${fromUint8Array(encode(this.iframeKind))}`;
        return this.renderIframe(iframeSrc);
    }
    const productionSrc = intoOrigin(this.iframeKind) + renderViewToQueryString(this.renderView);
    return this.renderIframe(productionSrc);
  }

  static styles = [
    css`
      :host {
        display: flex;
      }
    `,
    mossStyles,
  ];
}
