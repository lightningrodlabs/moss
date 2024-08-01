import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  AppletInfo,
  AssetLocationAndInfo,
  encodeContext,
  GroupProfile,
  WAL,
  stringifyHrl,
  WeaveLocation,
  WeaveUrl,
  weaveUrlToLocation,
  WeaveClient,
} from '@lightningrodlabs/we-applet';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import { appletOrigin, urlFromAppletHash } from '../utils';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { DnaHash } from '@holochain/client';
import { mdiArrowCollapse, mdiArrowExpand, mdiClose, mdiNoteEdit, mdiOpenInNew } from '@mdi/js';
import { localized, msg } from '@lit/localize';
import { getAppletInfoAndGroupsProfiles } from '../utils';

@localized()
@customElement('wal-space')
export class WalSpace extends LitElement {
  @property()
  wals!: WeaveUrl[];

  @state()
  appletInfo: AppletInfo | undefined;

  @state()
  groupProfiles: ReadonlyMap<DnaHash, GroupProfile> | undefined;

  @state()
  editing: boolean = false;

  async firstUpdated() {}

  renderContent() {
    html`editing: ${this.editing}`;
  }

  toggleEdit() {
    this.editing = !this.editing;
  }

  render() {
    return html`
      <div class="container">
        <div class="top-bar row" style="align-items: center;">
          ${this.appletInfo
            ? html`
                <div
                  class="row"
                  style="align-items: center; ${this.groupProfiles
                    ? 'border-right: 2px solid black;'
                    : ''}"
                >
                  <sl-tooltip .content=${this.appletInfo.appletName}>
                    <img
                      style="height: 26px; margin-right: 4px; border-radius: 3px;"
                      .src=${this.appletInfo.appletIcon}
                    />
                  </sl-tooltip>
                </div>
              `
            : html``}
          ${this.groupProfiles
            ? html` <div class="row" style="align-items: center; margin-left: 4px;">
                ${Array.from(this.groupProfiles.values()).map(
                  (groupProfile) => html`
                    <sl-tooltip .content=${groupProfile.name}>
                      <img
                        src=${groupProfile.icon_src}
                        style="height: 26px; width: 26px; border-radius: 50%; margin-right: 2px;"
                      />
                    </sl-tooltip>
                  `,
                )}
              </div>`
            : html``}
          <sl-tooltip .content=${msg('Edit')}>
            <div
              class="column center-content open-btn"
              tabindex="0"
              @click=${async () => await this.toggleEdit()}
              @keypress=${async (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  await this.toggleEdit();
                }
              }}
            >
              <sl-icon .src=${wrapPathInSvg(mdiNoteEdit)} style="font-size: 24px;"></sl-icon>
            </div>
          </sl-tooltip>
        </div>
        ${this.renderContent()}
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      .container {
        border-right: 2px solid #8595bf;
        border-left: 2px solid #8595bf;
        border-bottom: 2px solid #8595bf;
        border-radius: 3px;
        resize: both;
        font-family: 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;
      }

      .top-bar {
        height: 30px;
        background: #8595bf;
        position: relative;
      }
    `,
  ];
}
