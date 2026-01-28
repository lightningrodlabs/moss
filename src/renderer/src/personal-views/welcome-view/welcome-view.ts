import { html, LitElement, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';

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
import { MossDialog } from '../../elements/_new_design/moss-dialog.js';
import '../../elements/_new_design/moss-dialog.js';
import { PersistedStore } from '../../persisted-store.js';

import '@shoelace-style/shoelace/dist/components/switch/switch.js';

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
  _feedbackDialog!: MossDialog;

  @property()
  updateFeed!: Array<UpdateFeedMessage>;

  @state()
  availableMossUpdate: MossUpdateInfo | undefined;

  @state()
  mossUpdatePercentage: number | undefined;

  @state()
  updatingTool = false;

  @state()
  _designFeedbackMode = false;

  private _persistedStore = new PersistedStore();

  availableToolUpdates = new StoreSubscriber(
    this,
    () => this._mossStore.availableToolUpdates(),
    () => [this._mossStore],
  );

  timeAgo = new TimeAgo('en-US');

  connectedCallback() {
    super.connectedCallback();
    this._designFeedbackMode = this._persistedStore.designFeedbackMode.value();
    window.addEventListener('design-feedback-mode-changed', this._onDesignFeedbackModeChanged as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('design-feedback-mode-changed', this._onDesignFeedbackModeChanged as EventListener);
  }

  private _onDesignFeedbackModeChanged = (e: CustomEvent<boolean>) => {
    this._designFeedbackMode = e.detail;
  };

  private _enableDesignFeedbackMode() {
    this._designFeedbackMode = true;
    this._persistedStore.designFeedbackMode.set(true);
    window.dispatchEvent(
      new CustomEvent('design-feedback-mode-changed', {
        detail: true,
        bubbles: true,
        composed: true,
      }),
    );
    this._feedbackDialog.hide();
  }

  async firstUpdated() {
    const availableMossUpdate = await window.electronAPI.mossUpdateAvailable();
    const declinedUpdates = this._mossStore.persistedStore.declinedMossUpdates.value();
    if (availableMossUpdate && !declinedUpdates.includes(availableMossUpdate.version)) {
      this.availableMossUpdate = availableMossUpdate;
      window.electronAPI.onMossUpdateProgress((_, progressInfo) => {
        this.mossUpdatePercentage = progressInfo.percent;
        console.log('Download progress: ', progressInfo);
      });
    }
  }

  async declineMossUpdate() {
    if (this.availableMossUpdate) {
      const declinedUpdates = this._mossStore.persistedStore.declinedMossUpdates.value();
      declinedUpdates.push(this.availableMossUpdate.version);
      this._mossStore.persistedStore.declinedMossUpdates.set(declinedUpdates);
    }
    this.availableMossUpdate = undefined;
  }

  async installMossUpdate() {
    if (!this.availableMossUpdate) {
      notifyError('No update available.');
      return;
    }
    try {
      this.mossUpdatePercentage = 1;
      await window.electronAPI.installMossUpdate();
    } catch (e) {
      console.error('Moss update failed: ', e);
      notifyError('Update failed (see console for details).');
      this.mossUpdatePercentage = undefined;
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
    return html` <moss-dialog
      id="feedback-dialog"
      class="gradient"
      width="900px"
    >
        <div
          class="row" slot="header"
        >
          ${commentHeartIconFilled(28)}
          <span style="margin-left: 5px;">${msg('Feedback')}</span>
        </div>
        <div slot="content">
          ${msg('Moss development is in alpha stage. We highly appreciate active feedback.')}<br /><br />

          <!-- Design Feedback Mode Section -->
          <div class="design-feedback-section">
            <h3 style="margin: 0 0 8px 0;">${msg('Design Feedback Mode')}</h3>
            <p style="margin: 0 0 12px 0; opacity: 0.9;">
              ${msg('Enable Design Feedback Mode to capture screenshots and submit visual feedback directly from anywhere in the app. A feedback button will appear in the top-right corner, allowing you to select any area of the screen and describe your feedback.')}
            </p>
            <p style="margin: 0 0 12px 0; opacity: 0.7; font-size: 14px;">
              ${msg('You can also enable or disable this mode in Settings > Feedback.')}
            </p>
            <sl-button
              variant="primary"
              @click=${() => this._enableDesignFeedbackMode()}
            >
              <div class="row items-center">
                ${commentHeartIconFilled(18)}
                <span style="margin-left: 6px;">${msg('Enable Design Feedback Mode')}</span>
              </div>
            </sl-button>
          </div>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid rgba(255,255,255,0.2);" />

          <h3 style="margin: 0 0 8px 0;">${msg('Other Ways to Give Feedback')}</h3>

          ${msg('If you are encountering a problem and are familiar with Github, you can')}<br /><br />

          <a href="https://github.com/lightningrodlabs/moss/issues/new"
            >${msg('create an issue on Github')}</a
          >
          <br />
          <br />
          ${msg('If you have more general feedback or are not familiar with Github, you can write to the following email address:')}<br /><br />

          <a href="mailto:moss.0.15.feedback@theweave.social">moss.0.15.feedback@theweave.social</a>
        </div>
      </div>
    </moss-dialog>`;
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
            <img src="icon.png" class="moss-icon" />
            <div style="margin-left: 10px; font-weight: bold; font-size: 28px;">
              ${msg('Moss Update Available:')}
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
            ${this.mossUpdatePercentage
        ? html`<span class="flex flex-1"></span>
                  <div class="column">
                    <div>${msg('Installing...')}</div>
                    <sl-progress-bar
                      value="${this.mossUpdatePercentage}"
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
        <h1>🏄 &nbsp;&nbsp;${msg('Moss Updates')}&nbsp;&nbsp; 🚧</h1>
        <span style="margin-top: 10px; margin-bottom: 30px; font-size: 18px;"
          >${msg('Thank you for surfing the edge of')}
          <a href="https://theweave.social" style="color: yellow;">${msg('the Weave')}</a>. ${msg('Below are relevant updates for early weavers.')}</span
        >
        ${this.availableMossUpdate ? this.renderMossUpdateAvailable() : html``}
        ${composedFeed.length === 0
        ? html`${msg('No big waves lately...')}`
        : composedFeed.map(
          (message) => html`
                <div class="update-feed-el">
                  <div class="update-date">${this.timeAgo.format(message.timestamp)}</div>
                  <div class="update-type">
                    ${message.type === 'Moss' ? message.content.type : msg('Tool Update')}
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
          <loading-dialog id="loading-dialog" .loadingText=${msg('Updating Tool...')}></loading-dialog>
          ${this.renderFeedbackDialog()}
          <div class="flex-scrollable-parent" style="width: 870px;">
            <div class="flex-scrollable-container">
              <div class="column flex-scrollable-y">
                <div class="column" style="align-items: center; flex: 1; overflow: auto;">
                  ${!this._designFeedbackMode
                    ? html`
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
                    `
                    : html``}

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
        width: 58px;
        height: 58px;
        border-radius: 15px;
        box-shadow: 0 0 2px 2px #0000001f;
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

      .design-feedback-section {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        padding: 16px;
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
        background: var(--moss-dark-green);
        margin: 6px;
        color: #fff;
        box-shadow: 0 0 2px 2px var(--moss-dark-green);
        /* border: 2px solid #102520; */
        transition: all 0.25s ease;
        font-size: 18px;
        line-height: 1.4;
      }

      .update-feed-el a {
        color: #07cd07;
      }

      .bg-highlighted {
        background: var(--moss-fishy-green);
        color: black;
        box-shadow: 0 0 2px 2px var(--moss-dark-green);
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
