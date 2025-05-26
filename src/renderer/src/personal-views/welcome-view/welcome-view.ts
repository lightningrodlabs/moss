import { html, LitElement, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { notify, notifyError } from '@holochain-open-dev/elements';

import { mossStyles } from '../../shared-styles.js';
import '../../elements/dialogs/select-group-dialog.js';
import './elements/feed-element.js';
import '../../applets/elements/applet-logo.js';
import '../../applets/elements/applet-title.js';
import '../../elements/dialogs/loading-dialog.js';
import { mossStoreContext } from '../../context.js';
import { consume } from '@lit/context';
import { MossStore } from '../../moss-store.js';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import TimeAgo from 'javascript-time-ago';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { markdownParseSafe, refreshAllAppletIframes } from '../../utils.js';
import { MossUpdateInfo } from '../../electron-api.js';
import { LoadingDialog } from '../../elements/dialogs/loading-dialog.js';
import { ToolInfoAndLatestVersion, UpdateFeedMessage } from '../../types.js';
import { commentHeartIconFilled } from '../../icons/icons.js';

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
        tool: ToolInfoAndLatestVersion;
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

  @query('#feedback-dialog')
  _feedbackDialog!: SlDialog;

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

  async updateTool(toolInfo: ToolInfoAndLatestVersion) {
    try {
      this.updatingTool = true;
      if (toolInfo.distributionInfo.type !== 'web2-tool-list')
        throw new Error("Cannot update Tool from distribution type other than 'web2-tool-list'");

      const appletIds = await window.electronAPI.batchUpdateAppletUis(
        toolInfo.distributionInfo.info.toolCompatibilityId,
        toolInfo.latestVersion.url,
        toolInfo.distributionInfo,
        toolInfo.latestVersion.hashes.happSha256,
        toolInfo.latestVersion.hashes.uiSha256,
        toolInfo.latestVersion.hashes.webhappSha256,
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

  renderFeedbackDialog() {
    return html` <sl-dialog
      id="feedback-dialog"
      class="moss-dialog"
      no-header
      style="--width: 900px; --sl-panel-background-color: #fff4f4;"
      no-header
    >
      <div class="feedback">
        <div
          class="row"
          style="align-items: center; font-size: 30px; justify-content: center; margin-bottom: 28px;"
        >
          ${commentHeartIconFilled(28)}
          <span style="margin-left: 5px;">Feedback</span>
        </div>
        <div style="max-width: 800px; margin-top: 20px; font-size: 20px;">
          Moss development is in alpha stage. We highly appreciate active feedback.<br /><br />

          If you are encountering a problem and are familiar with Github, you can<br /><br />

          <a href="https://github.com/lightningrodlabs/moss/issues/new"
            >create an issue on Github</a
          >
          <br />
          <br />
          If you have more general feedback or are not familiar with Github, you can write to the
          following email address:<br /><br />

          <a href="mailto:moss.0.13.feedback@theweave.social">moss.0.13.feedback@theweave.social</a>
        </div>
      </div>
    </sl-dialog>`;
  }

  renderToolUpdate(toolInfo: ToolInfoAndLatestVersion) {
    return html`
      <div class="column">
        <div class="row" style="align-items: center;">
          <img
            src=${toolInfo.toolInfo.icon}
            style="width: 70px; height: 70px; border-radius: 14px;"
          />
          <div style="margin-left: 10px; font-weight: bold; font-size: 28px;">
            ${toolInfo.toolInfo.title}
          </div>
          <div style="margin-left: 10px; font-size: 28px; opacity: 0.6;">
            ${toolInfo.latestVersion.version}
          </div>
          <span style="display: flex; flex: 1;"></span>
          <sl-button
            ?disabled=${this.updatingTool}
            ?loading=${this.updatingTool}
            @click=${() => this.updateTool(toolInfo)}
            >${msg('Install Update')}</sl-button
          >
        </div>
        ${toolInfo.latestVersion.changelog
          ? html`<div>${unsafeHTML(markdownParseSafe(toolInfo.latestVersion.changelog))}</div>`
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
    ).map((toolInfo) => ({
      type: 'Tool',
      timestamp: toolInfo.latestVersion.releasedAt,
      content: {
        tool: toolInfo,
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
          ${this.renderFeedbackDialog()}
          <div class="flex-scrollable-parent" style="width: 870px;">
            <div class="flex-scrollable-container">
              <div class="column flex-scrollable-y">
                <div class="column" style="align-items: center; flex: 1; overflow: auto;">
                  <button
                    class="feedback-btn"
                    style="position: absolute; top: 20px; right: 10px;"
                    @click=${() => this._feedbackDialog.show()}
                  >
                    <div class="row items-center" style="font-size: 26px; justify-content: center;">
                      <span style="margin-bottom: -2px;">${commentHeartIconFilled(24)}</span>
                      <span style="margin-left: 5px;">${msg('Feedback')}</span>
                    </div>
                  </button>

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
        /* background-color: #224b21; */
        /* background-color: var(--moss-dark-green); */
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

      .feedback {
        color: #002a00;
        padding: 20px;
        border-radius: 20px;
        line-height: 1.2;
      }

      .feedback-btn {
        all: unset;
        /* background: linear-gradient(180deg, #1c251e 0%, #2c3a1c 69.5%, #4c461b 95%); */
        background: #ffffff5c;
        border-radius: 16px;
        padding: 16px 20px;
        font-size: 18px;
        font-weight: 500;
        line-height: 20px;
        color: white;
        cursor: pointer;
        text-align: center;
        --sl-color-neutral-0: black;
        --sl-color-primary-50: #455b36;
      }
      .feedback-btn:hover {
        background: linear-gradient(#912f2f, #983441);
      }
      .feedback-btn:disabled {
        opacity: 0.4;
        background: var(--moss-grey-green);
        cursor: default;
      }

      .feedback-btn:focus-visible {
        outline: 2px solid var(--moss-purple);
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
    mossStyles,
  ];
}
