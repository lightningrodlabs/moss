import { css, html, LitElement } from 'lit';
import { provide } from '@lit/context';
import { customElement, property } from 'lit/decorators.js';

import { weaveClientContext } from '../context';
import { WeaveClient, WeaveServices } from '@lightningrodlabs/we-applet';

@customElement('weave-client-context')
export class WeaveClientContext extends LitElement {
  @provide({ context: weaveClientContext })
  @property({ type: Object })
  weaveClient!: WeaveClient | WeaveServices;

  render() {
    return html`<slot></slot>`;
  }

  static styles = css`
    :host {
      display: contents;
    }
  `;
}
