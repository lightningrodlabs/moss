import { html, LitElement, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { notify, notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import {
  mdiAccountLockOpen,
  mdiAccountMultiple,
  mdiAccountMultiplePlus,
  mdiAlert,
  mdiStoreSearch,
  mdiTools,
  mdiUpload,
} from '@mdi/js';

import { weStyles } from '../../shared-styles.js';
import '../../elements/select-group-dialog.js';
import '../../elements/feed-element.js';
import '../../applets/elements/applet-logo.js';
import '../../applets/elements/applet-title.js';
import '../../elements/loading-dialog.js';
import { mossStoreContext } from '../../context.js';
import { consume } from '@lit/context';
import { MossStore } from '../../moss-store.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { encodeHashToBase64 } from '@holochain/client';
import { AppHashes, AssetSource, DistributionInfo, UpdateFeedMessage } from '../../types.js';
import TimeAgo from 'javascript-time-ago';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { Tool, UpdateableEntity } from '../../tools-library/types.js';
import { markdownParseSafe } from '../../utils.js';
import { dialogMessagebox } from '../../electron-api.js';
import { LoadingDialog } from '../../elements/loading-dialog.js';

type UpdateFeedMessageGeneric =
  | {
      type: 'Moss';
      timestamp: number;
      content: {
        type: string;
        timestamp: number;
        message: string;
      };
    }
  | {
      type: 'Tool';
      timestamp: number;
      content: {
        tool: UpdateableEntity<Tool>;
      };
    };

enum WelcomePageView {
  Main,
}
@localized()
@customElement('welcome-view')
export class WelcomeView extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  _mossStore!: MossStore;

  @state()
  view: WelcomePageView = WelcomePageView.Main;

  @state()
  notificationsLoading = true;

  @query('#disclaimer-dialog')
  _displaimerDialog!: SlDialog;

  @property()
  updateFeed!: Array<UpdateFeedMessage>;

  availableToolUpdates = new StoreSubscriber(
    this,
    () => this._mossStore.availableToolUpdates(),
    () => [this._mossStore],
  );

  timeAgo = new TimeAgo('en-US');

  // _notificationFeed = new StoreSubscriber(
  //   this,
  //   () => this._mossStore.notificationFeed(),
  //   () => [this._mossStore],
  // );

  async updateTool(toolEntity: UpdateableEntity<Tool>) {
    const confirmation = await dialogMessagebox({
      message:
        'Updating a Tool UI will refresh the full Moss window. If you have unsaved changes in one of your Tools, save them first.',
      type: 'warning',
      buttons: ['Cancel', 'Continue'],
    });
    if (confirmation.response === 0) return;
    (this.shadowRoot!.getElementById('loading-dialog') as LoadingDialog).show();

    try {
      const assetsSource: AssetSource = JSON.parse(toolEntity.record.entry.source);
      if (assetsSource.type !== 'https')
        throw new Error("Updating of applets is only implemented for sources of type 'http'");
      const toolsLibraryDnaHash = await this._mossStore.toolsLibraryStore.toolsLibraryDnaHash();
      const distributionInfo: DistributionInfo = {
        type: 'tools-library',
        info: {
          toolsLibraryDnaHash: encodeHashToBase64(toolsLibraryDnaHash),
          originalToolActionHash: encodeHashToBase64(toolEntity.originalActionHash),
          toolVersionActionHash: encodeHashToBase64(toolEntity.record.actionHash),
          toolVersionEntryHash: encodeHashToBase64(toolEntity.record.entryHash),
        },
      };
      const appHashes: AppHashes = JSON.parse(toolEntity.record.entry.hashes);
      if (appHashes.type !== 'webhapp')
        throw new Error(`Got invalid AppHashes type: ${appHashes.type}`);

      await window.electronAPI.batchUpdateAppletUis(
        encodeHashToBase64(toolEntity.originalActionHash),
        encodeHashToBase64(toolEntity.record.actionHash),
        assetsSource.url,
        distributionInfo,
        appHashes.happ.sha256,
        appHashes.ui.sha256,
        appHashes.sha256,
      );
      await this._mossStore.checkForUiUpdates();
      (this.shadowRoot!.getElementById('loading-dialog') as LoadingDialog).hide();
      notify(msg('Tool updated.'));
      // Required to have the browser refetch the UI. A nicer approach would be to selectively only
      // reload the iframes associated to that applet
      window.location.reload();
    } catch (e) {
      console.error(`Failed to update Tool: ${e}`);
      notifyError(msg('Failed to update Tool.'));
      (this.shadowRoot!.getElementById('loading-dialog') as LoadingDialog).hide();
    }
  }

  resetView() {
    this.view = WelcomePageView.Main;
  }

  renderDisclaimerDialog() {
    return html` <sl-dialog
      id="disclaimer-dialog"
      style="--width: 900px; --sl-panel-background-color: #f0f59d;"
      no-header
    >
      <div class="disclaimer">
        <div
          class="row"
          style="align-items: center; font-size: 30px; justify-content: center; margin-bottom: 28px;"
        >
          <sl-icon .src=${wrapPathInSvg(mdiAlert)}></sl-icon>
          <span style="margin-left: 5px;">Moss is Alpha Software</span>
        </div>
        <div style="max-width: 800px; margin-top: 20px; font-size: 20px;">
          Moss development is in alpha stage. It is best suited for
          <b>adventurous early-adopters</b>. Please
          <b>don't expect it to be stable or bug free!</b> That said, we use Moss in-house daily for
          doing our work on Moss itself, using the tools for planning, chatting, video calls, etc.
          <br /><br />
          We <b>export data from our Tools/Applets frequently</b> and sometimes have to recover from
          these backups. We recommend you do the same. <br /><br />
          What you can/should expect:
          <ul>
            <li>
              If Moss offers you to install an update on startup, this update will always be
              compatible with your current version of Moss. Compatible versions of Moss are
              indicated by the first non-zero number in the version name. If you are using Moss
              0.11.5 it is compatible with Moss 0.11.8 but it is <i>not</i> compatible with Moss
              0.12.0.
            </li>
            <li>
              You can <b>not</b> expect your current version of Moss to receive ongoing bugfixes
              until we explicitly say so. That said, we are targeting to release a version "Moss
              Sprout" in the coming months that will receive support in the form of bugfixes and UI
              improvements for a defined period of time. Until that point there will be a succession
              of breaking releases of Moss (0.12.x, 0.13.x, ...) that are going to be incompatible
              between each other, meaning that if you decide to go to a newer version, you will not
              be able to access or join groups created in the previous version.
            </li>
            <li>
              As we are developing Moss and the Weave, we are also continually trying to find the
              most suitable naming and terminology. Expect therefore names of things to keep
              changing in the near future. One notable change is likely going to be "Applet" to
              "Tool".
            </li>
          </ul>
        </div>
      </div>
    </sl-dialog>`;
  }

  renderToolUpdate(toolEntity: UpdateableEntity<Tool>) {
    const tool = toolEntity.record.entry;
    return html`
      <div class="column">
        <div class="row" style="align-items: center;">
          <img src=${tool.icon} style="width: 70px; height: 70px; border-radius: 14px;" />
          <div style="margin-left: 10px; font-weight: bold; font-size: 28px;">${tool.title}</div>
          <div style="margin-left: 10px; font-size: 28px; opacity: 0.6;">${tool.version}</div>
          <span style="display: flex; flex: 1;"></span>
          <sl-button @click=${() => this.updateTool(toolEntity)}
            >${msg('Install Update')}</sl-button
          >
        </div>
        ${tool.changelog
          ? html`<div>${unsafeHTML(markdownParseSafe(tool.changelog))}</div>`
          : html``}
      </div>
    `;
  }

  renderUpdateFeed() {
    const mossFeed: UpdateFeedMessageGeneric[] = this.updateFeed.map((el) => ({
      type: 'Moss',
      timestamp: el.timestamp,
      content: el,
    }));

    const toolUpdates: UpdateFeedMessageGeneric[] = Object.values(
      this.availableToolUpdates.value,
    ).map((entity) => ({
      type: 'Tool',
      timestamp: entity.record.record.signed_action.hashed.content.timestamp / 1000,
      content: {
        tool: entity,
      },
    }));

    const composedFeed = [...mossFeed, ...toolUpdates].sort((a, b) => b.timestamp - a.timestamp);

    return html`
      <div
        class="column"
        style="align-items: center; display:flex; flex: 1; margin-top: 10px; color: white; margin-bottom: 160px;"
      >
        <h1>🏄 &nbsp;&nbsp;Moss Updates&nbsp;&nbsp; 🚧</h1>
        <span style="margin-top: 10px; margin-bottom: 30px; font-size: 18px;"
          >Thank you for surfing the edge of
          <a href="https://theweave.social" style="color: yellow;">the Weave</a>. Below are relevant
          updates for early weavers.</span
        >

        ${composedFeed.length === 0
          ? html`No big waves lately...`
          : composedFeed.map(
              (message) => html`
                <div class="update-feed-el">
                  <div class="update-date">${this.timeAgo.format(message.timestamp)}</div>
                  <div class="update-type">
                    ${message.type === 'Moss' ? message.content.type : 'Tool Update'}
                  </div>
                  ${message.type === 'Moss'
                    ? unsafeHTML(markdownParseSafe(message.content.message))
                    : this.renderToolUpdate(message.content.tool)}
                </div>
              `,
            )}
      </div>
    `;
  }

  render() {
    switch (this.view) {
      case WelcomePageView.Main:
        return html`
          <loading-dialog id="loading-dialog" loadingText="Updating Tool..."></loading-dialog>
          ${this.renderDisclaimerDialog()}
          <div class="flex-scrollable-parent" style="width: 870px;">
            <div class="flex-scrollable-container">
              <div class="column flex-scrollable-y">
                <div class="column" style="align-items: center; flex: 1; overflow: auto;">
                  <div
                    class="disclaimer-btn"
                    tabindex="0"
                    @click=${() => this._displaimerDialog.show()}
                    @keypress=${(e: KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        this._displaimerDialog.show();
                      }
                    }}
                  >
                    <div
                      class="row"
                      style="align-items: center; font-size: 26px; justify-content: center;"
                    >
                      <sl-icon .src=${wrapPathInSvg(mdiAlert)}></sl-icon>
                      <span style="margin-left: 5px;">Disclaimer</span>
                    </div>
                  </div>
                  <div
                    class="row"
                    style="flex-wrap: wrap; margin-top: 60px; justify-content: center;"
                  >
                    <!-- Group section -->
                    <div class="column button-section">
                      <div class="row" style="align-items: center; font-size: 30px;">
                        <sl-icon .src=${wrapPathInSvg(mdiAccountMultiple)}></sl-icon>
                        <span style="margin-left: 10px;">Groups</span>
                      </div>
                      <div class="row" style="margin-top: 20px;">
                        <button
                          class="btn"
                          @click=${(_e) =>
                            this.dispatchEvent(
                              new CustomEvent('request-join-group', {
                                composed: true,
                                bubbles: true,
                              }),
                            )}
                          @keypress=${(e: KeyboardEvent) => {
                            if (e.key === 'Enter') {
                              this.dispatchEvent(
                                new CustomEvent('request-join-group', {
                                  composed: true,
                                  bubbles: true,
                                }),
                              );
                            }
                          }}
                        >
                          <div class="row center-content">
                            <sl-icon
                              .src=${wrapPathInSvg(mdiAccountLockOpen)}
                              style="color: white; height: 40px; width: 40px; margin-right: 10px;"
                            ></sl-icon>
                            <span>${'Join Group'}</span>
                          </div>
                        </button>
                        <button
                          class="btn"
                          @click=${() => {
                            this.dispatchEvent(
                              new CustomEvent('request-create-group', {
                                bubbles: true,
                                composed: true,
                              }),
                            );
                          }}
                          @keypress=${(e: KeyboardEvent) => {
                            if (e.key === 'Enter') {
                              this.dispatchEvent(
                                new CustomEvent('request-create-group', {
                                  bubbles: true,
                                  composed: true,
                                }),
                              );
                            }
                          }}
                        >
                          <div class="row center-content">
                            <sl-icon
                              .src=${wrapPathInSvg(mdiAccountMultiplePlus)}
                              style="color: white; height: 40px; width: 40px; margin-right: 10px;"
                            ></sl-icon>
                            <span>${msg('Create Group')}</span>
                          </div>
                        </button>
                      </div>
                    </div>

                    <!-- Tools section -->
                    <div class="column button-section">
                      <div class="row" style="align-items: center; font-size: 30px;">
                        <sl-icon .src=${wrapPathInSvg(mdiTools)}></sl-icon>
                        <span style="margin-left: 10px;">Tools</span>
                      </div>
                      <div class="row" style="margin-top: 20px;">
                        <button
                          class="btn"
                          @click=${() => {
                            this.dispatchEvent(new CustomEvent('open-appstore'));
                          }}
                          @keypress=${(e: KeyboardEvent) => {
                            if (e.key === 'Enter') {
                              this.dispatchEvent(new CustomEvent('open-appstore'));
                            }
                          }}
                        >
                          <div class="row center-content">
                            <sl-icon
                              .src=${wrapPathInSvg(mdiStoreSearch)}
                              style="color: white; height: 40px; width: 40px; margin-right: 10px;"
                            ></sl-icon>
                            <span>${msg('Browse Library')}</span>
                          </div>
                        </button>
                        <button
                          class="btn"
                          @click=${() => {
                            this.dispatchEvent(new CustomEvent('open-publishing-view'));
                          }}
                          @keypress=${(e: KeyboardEvent) => {
                            if (e.key === 'Enter') {
                              this.dispatchEvent(new CustomEvent('open-publishing-view'));
                            }
                          }}
                        >
                          <div class="row center-content">
                            <sl-icon
                              .src=${wrapPathInSvg(mdiUpload)}
                              style="color: white; height: 40px; width: 40px; margin-right: 10px;"
                            ></sl-icon>
                            <span>${msg('Publish Tool')}</span>
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>

                  <!-- Moss Update Feed -->

                  ${this.renderUpdateFeed()}
                </div>
              </div>
            </div>
          </div>
        `;
    }
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
        background-color: #588121;
        border-radius: 5px 0 0 0;
        /* opacity: 0.8; */
      }

      .recent-activity-header {
        color: #fff;
        opacity: 0.5;
        text-align: left;
      }

      .recent-activity-header h1 {
        font-size: 16px;
      }

      .btn {
        all: unset;
        margin: 12px;
        font-size: 16px;
        padding: 10px;
        background: transparent;
        border: 2px solid #607c02;
        color: white;
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.25s ease;
      }

      .btn:hover {
        background: #607c02;
      }

      .btn:active {
        background: var(--sl-color-secondary-300);
      }

      li {
        margin-top: 12px;
      }

      .disclaimer {
        color: #002a00;
        /* border: 2px solid #fff78e; */
        padding: 20px;
        border-radius: 20px;
        /* background: #fff78e1f; */
        line-height: 1.2;
      }

      .disclaimer-btn {
        position: absolute;
        top: 10px;
        right: 10px;
        /* background: #f4fb86; */
        background: linear-gradient(#e0e871, #acb520);
        border-radius: 12px;
        display: flex;
        align-items: center;
        flex-direction: row;
        padding: 10px;
        box-shadow: 0 0 2px 2px #3a622d;
        cursor: pointer;
      }

      .disclaimer-btn:hover {
        background: linear-gradient(#f2f98e, #b6c027);
      }

      .button-section {
        align-items: center;
        color: white;
        /* background: #224b21; */
        /* background: #102520; */
        background: #1e3b25;
        margin: 30px;
        padding: 30px;
        box-shadow: 0 0 2px 2px #3a622d;
        border-radius: 15px;
      }

      .update-feed-el {
        width: 700px;
        position: relative;
        padding: 20px;
        padding-top: 45px;
        border-radius: 10px;
        background: #193423;
        margin: 6px;
        color: #fff;
        box-shadow: 0 0 2px 2px #193423;
        /* border: 2px solid #102520; */
        transition: all 0.25s ease;
        font-size: 18px;
        line-height: 1.4;
      }

      .update-feed-el a {
        color: #07cd07;
      }

      .update-date {
        position: absolute;
        font-size: 14px;
        top: 12px;
        left: 20px;
        opacity: 0.6;
      }

      .update-type {
        font-size: 20px;
        position: absolute;
        top: 7px;
        right: 12px;
        font-weight: bold;
      }

      .feed {
        max-height: calc(100vh - 200px);
        overflow-y: auto;
      }

      .feed::-webkit-scrollbar {
        background-color: rgba(57, 67, 51, 1);
      }

      .feed::-webkit-scrollbar-thumb {
        background: rgba(84, 109, 69, 1);
        border-radius: 10px;
      }
    `,
    weStyles,
  ];
}
