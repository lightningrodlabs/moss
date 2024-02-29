import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  AttachableLocationAndInfo,
  encodeContext,
  HrlWithContext,
  stringifyHrl,
  WeClient,
} from '@lightningrodlabs/we-applet';
import { appletOrigin, urlFromAppletHash } from '../utils.js';

@customElement('wal-embed')
export class WalEmbed extends LitElement {
  @property()
  weClient!: WeClient;

  @property()
  hrlWithContext!: HrlWithContext;

  @state()
  attachableInfo: AttachableLocationAndInfo | undefined;

  @state()
  iframeId: string | undefined;

  async firstUpdated() {
    this.attachableInfo = await this.weClient.attachableInfo(this.hrlWithContext);
    console.log('Got attachable info: ', this.attachableInfo);
    this.iframeId = Date.now().toString();
  }

  resizeIFrameToFitContent() {
    // console.log('Resizing.');
    // const iframe = this.shadowRoot?.getElementById(this.iframeId!.toString()) as
    //   | HTMLIFrameElement
    //   | null
    //   | undefined;
    // console.log('@resizeIFrameToFitContent: got iframe: ', iframe);
    // if (iframe && iframe.contentWindow) {
    //   console.log('scrollWidth: ', iframe.contentWindow.document.body.scrollWidth.toString());
    //   console.log('scrollHeight: ', iframe.contentWindow.document.body.scrollHeight.toString());
    //   iframe.width = iframe.contentWindow.document.body.scrollWidth.toString();
    //   iframe.height = iframe.contentWindow.document.body.scrollHeight.toString();
    // }
  }

  render() {
    const queryString = `view=applet-view&view-type=attachable&hrl=${stringifyHrl(
      this.hrlWithContext.hrl,
    )}${
      this.hrlWithContext.context ? `&context=${encodeContext(this.hrlWithContext.context)}` : ''
    }`;
    if (!this.attachableInfo) {
      return html`Weave Asset not found.`;
    }
    const iframeSrc = this.attachableInfo.appletDevPort
      ? `http://localhost:${this.attachableInfo.appletDevPort}?${queryString}#${urlFromAppletHash(
          this.attachableInfo.appletHash,
        )}`
      : `${appletOrigin(this.attachableInfo.appletHash)}?${queryString}`;

    return html`<iframe
      id="${this.iframeId}"
      frameborder="0"
      title="TODO"
      src="${iframeSrc}"
      style="flex: 1; display: block; padding: 0; margin: 0;"
      allow="clipboard-write;"
      @load=${() => {
        console.log('iframe loaded.');
        setTimeout(() => this.resizeIFrameToFitContent());
      }}
    ></iframe>`;
  }
}
