import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { hashProperty } from '@holochain-open-dev/elements';
import { encodeHashToBase64, EntryHash } from '@holochain/client';
import { consume } from '@lit-labs/context';
import { RenderView } from '@lightningrodlabs/we-applet';

import { weStyles } from '../../shared-styles.js';
import { appletOrigin, renderViewToQueryString } from '../../utils.js';
import { weStoreContext } from '../../context.js';
import { WeStore } from '../../we-store.js';

@customElement('view-frame')
export class ViewFrame extends LitElement {
  @consume({ context: weStoreContext })
  @state()
  weStore!: WeStore;

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  renderView!: RenderView;

  @property()
  iframeId: string | undefined;

  render() {
    console.log('rendering viewframe for appletHash: ', encodeHashToBase64(this.appletHash));
    console.log(
      `Querystring: ${appletOrigin(
        this.weStore.conductorInfo,
        this.appletHash,
      )}?${renderViewToQueryString(this.renderView)}`,
    );
    return html`<iframe
      frameborder="0"
      title="TODO"
      id=${this.iframeId ? this.iframeId : undefined}
      src="${appletOrigin(this.weStore.conductorInfo, this.appletHash)}?${renderViewToQueryString(
        this.renderView,
      )}"
      style="flex: 1; display: block; padding: 0; margin: 0;"
    ></iframe>`;
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
