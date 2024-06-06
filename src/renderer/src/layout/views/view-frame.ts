import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { hashProperty } from '@holochain-open-dev/elements';
import { encodeHashToBase64, EntryHash } from '@holochain/client';
import { consume } from '@lit/context';
import { RenderView } from '@lightningrodlabs/we-applet';

import { weStyles } from '../../shared-styles.js';
import {
  appIdFromAppletHash,
  appletOrigin,
  renderViewToQueryString,
  urlFromAppletHash,
} from '../../utils.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { getAppletDevPort } from '../../electron-api.js';

@customElement('view-frame')
export class ViewFrame extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  mossStore!: MossStore;

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  renderView!: RenderView;

  @state()
  appletDevPort: number | undefined;

  async firstUpdated() {
    console.log('@view-frame: IS APPLET DEV: ', this.mossStore.isAppletDev);
    if (this.mossStore.isAppletDev) {
      const appId = appIdFromAppletHash(this.appletHash);
      this.appletDevPort = await getAppletDevPort(appId);
      console.log('@view-frame @devmode: Got applet dev port: ', this.appletDevPort);
    }
  }

  renderProductionFrame() {
    return html`<iframe
      frameborder="0"
      title="TODO"
      id=${this.renderView.type === 'applet-view' && this.renderView.view.type === 'main'
        ? encodeHashToBase64(this.appletHash)
        : undefined}
      src="${appletOrigin(this.appletHash)}?${renderViewToQueryString(this.renderView)}"
      style="flex: 1; display: block; padding: 0; margin: 0;"
      allow="camera *; microphone *; clipboard-write *;"
    ></iframe>`;
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
          style="flex: 1; display: block; padding: 0; margin: 0;"
          allow="camera *; microphone *; clipboard-write *;"
        ></iframe>`;
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
