import { html, LitElement, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { notify, notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiAlert } from '@mdi/js';

import { weStyles } from '../../shared-styles.js';
import '../../elements/dialogs/select-group-dialog.js';
import './elements/feed-element.js';
import '../../applets/elements/applet-logo.js';
import '../../applets/elements/applet-title.js';
import '../../elements/dialogs/loading-dialog.js';
import { mossStoreContext } from '../../context.js';
import { consume } from '@lit/context';
import { MossStore } from '../../moss-store.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { encodeHashToBase64 } from '@holochain/client';
import { AppHashes, AssetSource, DistributionInfo } from '@theweave/moss-types';
import TimeAgo from 'javascript-time-ago';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { Tool, UpdateableEntity } from '@theweave/tool-library-client';
import { markdownParseSafe, refreshAllAppletIframes } from '../../utils.js';
import { MossUpdateInfo } from '../../electron-api.js';
import { LoadingDialog } from '../../elements/dialogs/loading-dialog.js';
import { UpdateFeedMessage } from '../../types.js';

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

  @query('#disclaimer-dialog')
  _disclaimerDialog!: SlDialog;

  @property()
  updateFeed!: Array<UpdateFeedMessage>;

  @state()
  availableMossUpdate: MossUpdateInfo | undefined;

  @state()
  mossUpdatePrecentage: number | undefined;

  @state()
  updatingTool = false;

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

  async firstUpdated() {
    const availableMossUpdate = await window.electronAPI.mossUpdateAvailable();
    const declinedUdpates = this._mossStore.persistedStore.declinedMossUpdates.value();
    if (availableMossUpdate && !declinedUdpates.includes(availableMossUpdate.version)) {
      this.availableMossUpdate = availableMossUpdate;
      window.electronAPI.onMossUpdateProgress((_, progressInfo) => {
        this.mossUpdatePrecentage = progressInfo.percent;
        console.log('Download progress: ', progressInfo);
      });
    }
  }

  async declineMossUpdate() {
    if (this.availableMossUpdate) {
      const declinedUdpates = this._mossStore.persistedStore.declinedMossUpdates.value();
      declinedUdpates.push(this.availableMossUpdate.version);
      this._mossStore.persistedStore.declinedMossUpdates.set(declinedUdpates);
    }
    this.availableMossUpdate = undefined;
  }

  async installMossUpdate() {
    if (!this.availableMossUpdate) {
      notifyError('No update available.');
      return;
    }
    try {
      this.mossUpdatePrecentage = 1;
      await window.electronAPI.installMossUpdate();
    } catch (e) {
      console.error('Moss udpate failed: ', e);
      notifyError('Update failed (see console for details).');
      this.mossUpdatePrecentage = undefined;
    }
  }

  async updateTool(toolEntity: UpdateableEntity<Tool>) {
    try {
      this.updatingTool = true;
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

      const appletIds = await window.electronAPI.batchUpdateAppletUis(
        encodeHashToBase64(toolEntity.originalActionHash),
        encodeHashToBase64(toolEntity.record.actionHash),
        assetsSource.url,
        distributionInfo,
        appHashes.happ.sha256,
        appHashes.ui.sha256,
        appHashes.sha256,
      );
      console.log('UPDATED UI FOR APPLET IDS: ', appletIds);
      await this._mossStore.checkForUiUpdates();
      (this.shadowRoot!.getElementById('loading-dialog') as LoadingDialog).hide();
      notify(msg('Tool updated.'));
      // Reload all the associated UIs
      appletIds.forEach((id) => refreshAllAppletIframes(id));
      this.updatingTool = false;
    } catch (e) {
      this.updatingTool = false;
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
          <sl-button
            ?disabled=${this.updatingTool}
            ?loading=${this.updatingTool}
            @click=${() => this.updateTool(toolEntity)}
            >${msg('Install Update')}</sl-button
          >
        </div>
        ${tool.changelog
          ? html`<div>${unsafeHTML(markdownParseSafe(tool.changelog))}</div>`
          : html``}
      </div>
    `;
  }

  renderMossUpdateAvailable() {
    return html`
      <div class="update-feed-el bg-highlighted">
        <div class="update-date">
          ${this.availableMossUpdate?.releaseDate
            ? this.timeAgo.format(new Date(this.availableMossUpdate.releaseDate))
            : ''}
        </div>
        <div class="update-type"></div>
        <div class="column">
          <div class="row" style="align-items: center;">
            <div class="moss-icon column center-content">
              <img src="moss-icon.svg" style="width: 40px; height: 40px; border-radius: 14px;" />
            </div>
            <div style="margin-left: 10px; font-weight: bold; font-size: 28px;">
              Moss Update Available:
            </div>
            <div style="margin-left: 10px; font-size: 28px;">
              v${this.availableMossUpdate?.version}
            </div>
            <span style="display: flex; flex: 1;"></span>
          </div>
          <div>
            ${this.availableMossUpdate?.releaseNotes
              ? unsafeHTML(markdownParseSafe(this.availableMossUpdate.releaseNotes))
              : ''}
          </div>
          <div class="row center-content" style="margin-top: 15px;">
            ${this.mossUpdatePrecentage
              ? html`<span class="flex flex-1"></span>
                  <div class="column">
                    <div>Installing...</div>
                    <sl-progress-bar
                      value="${this.mossUpdatePrecentage}"
                      style="width: 200px; --height: 15px;"
                    ></sl-progress-bar>
                  </div> `
              : html`
                  <span class="flex flex-1"></span>
                  <sl-button
                    variant="danger"
                    style="margin-right: 5px;"
                    @click=${() => this.declineMossUpdate()}
                    >${msg('Decline')}</sl-button
                  >
                  <sl-button variant="primary" @click=${() => this.installMossUpdate()}
                    >${msg('Install and Restart')}</sl-button
                  >
                `}
          </div>
        </div>
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
        style="align-items: center; display:flex; flex: 1; margin-top: 80px; color: white; margin-bottom: 160px;"
      >
        <h1>🏄 &nbsp;&nbsp;Moss Updates&nbsp;&nbsp; 🚧</h1>
        <span style="margin-top: 10px; margin-bottom: 30px; font-size: 18px;"
          >Thank you for surfing the edge of
          <a href="https://theweave.social" style="color: yellow;">the Weave</a>. Below are relevant
          updates for early weavers.</span
        >
        ${this.availableMossUpdate ? this.renderMossUpdateAvailable() : html``}
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
                    @click=${() => this._disclaimerDialog.show()}
                    @keypress=${(e: KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        this._disclaimerDialog.show();
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
        /* background-color: #588121; */
        background-color: #224b21;
        border-radius: 5px 0 0 0;
        /* opacity: 0.8; */
      }

      .moss-icon {
        background: linear-gradient(0deg, #203923 0%, #527a22 100%);
        border-radius: 15px;
        border: none;
        width: 58px;
        height: 58px;
        outline: none;
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

      .bg-highlighted {
        background: #7e9100;
        box-shadow: 0 0 2px 2px #333b00;
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
