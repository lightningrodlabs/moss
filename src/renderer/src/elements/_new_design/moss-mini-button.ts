import { css, html, LitElement, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import { mossStyles } from '../../shared-styles.js';

/**
 * @element moss-mini-button
 */
@localized()
@customElement('moss-mini-button')
export class MossMiniButton extends LitElement {
  @property({ type: Boolean })
  loading = false;

  @property({ type: Boolean })
  disabled = false;

  @property()
  variant: 'primary' | 'secondary' = 'primary';

  @property()
  color = '';

  protected firstUpdated(_changedProperties: PropertyValues): void {
    if (this.color == '') this.loadingColor = this.variant == 'primary' ? 'white' : 'black';
  }

  @state()
  loadingColor = '';

  render() {
    return html`<button
      style="${this.color ? `color:${this.color};border-color:${this.color};` : ''} ${this.loading
        ? 'pointer-events: none'
        : ''}"
      class="moss-mini-button-${this.variant} ${this.disabled ? 'moss-mini-button-disabled' : ''}"
      @click=${(e) => {
        e.stopPropagation();
        if (this.disabled || this.loading) return;
        this.dispatchEvent(new CustomEvent('click', e));
      }}
    >
      ${this.loading
        ? html`<sl-spinner
              style="position:absolute; --indicator-color:${this.loadingColor}"
            ></sl-spinner
            ><slot style="visibility:hidden"></slot>`
        : html`<slot></slot>`}
    </button>`;
  }
  static styles = [mossStyles, css``];
}
