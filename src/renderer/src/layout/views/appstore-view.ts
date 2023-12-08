import { html, LitElement, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { weStyles } from '../../shared-styles.js';
import '../../elements/select-group-dialog.js';

enum WelcomePageView {
  Main,
  AppLibrary,
}
@localized()
@customElement('appstore-view')
export class AppStoreView extends LitElement {
  @state()
  view: WelcomePageView = WelcomePageView.Main;

  resetView() {
    this.view = WelcomePageView.Main;
  }

  renderAppLibrary() {
    return html`
      <div class="column" style="margin: 16px; flex: 1">
        <div class="row" style="margin-bottom: 16px; align-items: center">
          <span class="title" style="flex: 1">${msg('Applet Library')}</span>
          <sl-button
            @click=${() => {
              this.dispatchEvent(new CustomEvent('open-publishing-view'));
            }}
            @keypress=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                this.dispatchEvent(new CustomEvent('open-publishing-view'));
              }
            }}
            >Publish Applet
          </sl-button>
        </div>

        <installable-applets
          style="display: flex; flex: 1; overflow-y: auto;"
          @applet-installed=${(_e) => {
            // console.log("@group-home: GOT APPLET INSTALLED EVENT.");
            this.view = WelcomePageView.Main;
            // re-dispatch event since for some reason it doesn't bubble further
            // this.dispatchEvent(
            //   new CustomEvent("applet-installed", {
            //     detail: e.detail,
            //     composed: true,
            //     bubbles: true,
            //   })
            // );
          }}
        ></installable-applets>
      </div>
    `;
  }

  render() {
    return this.renderAppLibrary();
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
      }

      .btn {
        all: unset;
        margin: 12px;
        font-size: 25px;
        height: 100px;
        min-width: 300px;
        background: var(--sl-color-primary-800);
        color: white;
        border-radius: 10px;
        cursor: pointer;
        box-shadow: 0 2px 5px var(--sl-color-primary-900);
      }

      .btn:hover {
        background: var(--sl-color-primary-700);
      }

      .btn:active {
        background: var(--sl-color-primary-600);
      }
    `,
    weStyles,
  ];
}
