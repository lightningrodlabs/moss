import { html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  AttachableLocationAndInfo,
  encodeContext,
  HrlWithContext,
  stringifyHrl,
  WeaveLocation,
  WeaveUrl,
  weaveUrlToLocation,
  WeClient,
} from '@lightningrodlabs/we-applet';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import { appletOrigin, urlFromAppletHash } from '../utils.js';

type AssetStatus =
  | {
      type: 'invalid url';
    }
  | {
      type: 'success';
      attachableInfo: AttachableLocationAndInfo;
    }
  | {
      type: 'loading';
    }
  | {
      type: 'not found';
    };

@customElement('wal-embed')
export class WalEmbed extends LitElement {
  @property()
  weClient!: WeClient;

  @property()
  src!: WeaveUrl;

  @state()
  assetStatus: AssetStatus = { type: 'loading' };

  @state()
  hrlWithContext: HrlWithContext | undefined;

  @state()
  iframeId: string | undefined;

  async firstUpdated() {
    let weaveLocation: WeaveLocation | undefined;
    try {
      weaveLocation = weaveUrlToLocation(this.src);
    } catch (e) {
      this.assetStatus = { type: 'invalid url' };
      return;
    }
    if (weaveLocation.type !== 'asset') {
      this.assetStatus = { type: 'invalid url' };
    } else {
      this.hrlWithContext = weaveLocation.hrlWithContext;
      const attachableInfo = await this.weClient.attachableInfo(weaveLocation.hrlWithContext);
      this.assetStatus = attachableInfo
        ? { type: 'success', attachableInfo }
        : { type: 'not found' };
    }
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
    switch (this.assetStatus.type) {
      case 'not found':
        return html`Asset not found`;
      case 'invalid url':
        return html`invalid URL`;
      case 'loading':
        return html` <sl-spinner></sl-spinner> `;
      case 'success':
        const queryString = `view=applet-view&view-type=attachable&hrl=${stringifyHrl(
          this.hrlWithContext!.hrl,
        )}${
          this.hrlWithContext!.context
            ? `&context=${encodeContext(this.hrlWithContext!.context)}`
            : ''
        }`;
        const iframeSrc = this.assetStatus.attachableInfo.appletDevPort
          ? `http://localhost:${
              this.assetStatus.attachableInfo.appletDevPort
            }?${queryString}#${urlFromAppletHash(this.assetStatus.attachableInfo.appletHash)}`
          : `${appletOrigin(this.assetStatus.attachableInfo.appletHash)}?${queryString}`;

        return html`<iframe
          id="${this.iframeId}"
          frameborder="0"
          title="TODO"
          src="${iframeSrc}"
          style="flex: 1; display: block; padding: 5px; margin: 0; resize: both;"
          allow="clipboard-write;"
          @load=${() => {
            console.log('iframe loaded.');
            setTimeout(() => this.resizeIFrameToFitContent());
          }}
        ></iframe>`;
    }
  }
}
