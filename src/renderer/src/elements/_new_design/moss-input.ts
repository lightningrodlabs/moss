import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { localized } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio/radio.js';

import { mossStyles } from '../../shared-styles.js';

/**
 * @element create-group-dialog
 */
@localized()
@customElement('moss-input')
export class MossInput extends LitElement {

  render() {
    return html`
      <sl-input class="moss-input">
        <div class="column items-center">
          <span style="font-size: 30px; font-weight: 500;">My group is called</span>
        </div>
      </sl-input>
    `;
  }

  static styles = [mossStyles, css``];
}
