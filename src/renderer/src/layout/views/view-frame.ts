import { css, html, LitElement, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { hashProperty } from '@holochain-open-dev/elements';
import { encodeHashToBase64, EntryHash } from '@holochain/client';
import { consume } from '@lit/context';
import { RenderView } from '@theweave/api';

import { weStyles } from '../../shared-styles.js';
import { appletOrigin, renderViewToQueryString, urlFromAppletHash } from '../../utils.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';

@localized()
@customElement('view-frame')
export class ViewFrame extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  mossStore!: MossStore;

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  renderView!: RenderView;

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
      this.appletDevPort = await this.mossStore.getAppletDevPort(
        encodeHashToBase64(this.appletHash),
      );
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
        }, 5000);
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
        <img src="moss-icon.svg" style="height: 80px; width: 80px;" />
        <div style="margin-top: 25px; margin-left: 10px; font-size: 24px; color: #142510">
          ${this.reloading ? msg('reloading...') : msg('loading...')}
        </div>
        ${this.slowLoading
          ? html`
              <div
                class="column items-center"
                style="margin-top: 50px; max-width: 600px;color: white;"
              >
                <div>This Tool takes unusually long to reload. Do you want to force reload?</div>
                <div style="margin-top: 10px;">
                  (force reloading may interrupt the Tool from saving unsaved content)
                </div>
                <sl-button
                  variant="danger"
                  @click=${() => this.hardRefresh()}
                  style="margin-top: 20px; width: 150px;"
                  >Force Reload</sl-button
                >
              </div>
            `
          : html``}
      </div>
    `;
  }

  renderProductionFrame() {
    return html`<iframe
        frameborder="0"
        title="TODO"
        id=${this.renderView.type === 'applet-view' && this.renderView.view.type === 'main'
          ? encodeHashToBase64(this.appletHash)
          : undefined}
        src="${appletOrigin(this.appletHash)}?${renderViewToQueryString(this.renderView)}"
        style="flex: 1; display: ${this.loading ? 'none' : 'block'}; padding: 0; margin: 0;"
        allow="camera *; microphone *; clipboard-write *;"
        @load=${() => {
          this.loading = false;
        }}
      ></iframe>
      ${this.renderLoading()}`;
  }

  render() {
    switch (this.mossStore.isAppletDev) {
      case false:
        return this.renderProductionFrame();
      case true:
        if (!this.appletDevPort) {
          return this.renderProductionFrame();
        }
        const iframeSrc = `http://localhost:${this.appletDevPort}?${renderViewToQueryString(
          this.renderView,
        )}#${urlFromAppletHash(this.appletHash)}`;
        return html`<iframe
            frameborder="0"
            title="TODO"
            id=${this.renderView.type === 'applet-view' && this.renderView.view.type === 'main'
              ? encodeHashToBase64(this.appletHash)
              : undefined}
            src="${iframeSrc}"
            style="flex: 1; display: ${this.loading ? 'none' : 'block'}; padding: 0; margin: 0;"
            allow="camera *; microphone *; clipboard-write *;"
            @load=${() => {
              this.loading = false;
            }}
          ></iframe>
          ${this.renderLoading()}`;
    }
  }

  static styles = [
    css`
      :host {
        display: flex;
      }
    `,
    weStyles,
  ];
}
