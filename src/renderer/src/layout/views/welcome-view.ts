import { html, LitElement, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { wrapPathInSvg } from '@holochain-open-dev/elements';
import {
  mdiAccountLockOpen,
  mdiAccountMultiple,
  mdiAccountMultiplePlus,
  mdiAlert,
  mdiPublish,
  mdiStoreSearch,
  mdiTools,
  mdiUpload,
  mdiViewGridPlus,
} from '@mdi/js';

import { weStyles } from '../../shared-styles.js';
import '../../elements/select-group-dialog.js';
import '../../elements/feed-element.js';
import '../../applets/elements/applet-logo.js';
import '../../applets/elements/applet-title.js';
import { mossStoreContext } from '../../context.js';
import { consume } from '@lit/context';
import { MossStore } from '../../moss-store.js';
import { toPromise } from '@holochain-open-dev/stores';
import { encodeHashToBase64 } from '@holochain/client';
import { UpdateFeedMessage } from '../../types.js';
import TimeAgo from 'javascript-time-ago';
import { Marked } from '@ts-stack/markdown';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

Marked.setOptions({
  // renderer: new MyRenderer,
  // highlight: (code, lang) =>  {
  //   if (lang)
  //     return hljs.highlight(lang, code).value
  //   return code
  // },
  gfm: true,
  tables: true,
  breaks: false,
  pedantic: false,
  sanitize: true,
  smartLists: true,
  smartypants: false,
});

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

  timeAgo = new TimeAgo('en-US');

  // _notificationFeed = new StoreSubscriber(
  //   this,
  //   () => this._mossStore.notificationFeed(),
  //   () => [this._mossStore],
  // );

  async firstUpdated() {
    try {
      console.log('@ WELCOME-VIEW: loading notifications');
      const runningApplets = await toPromise(this._mossStore.runningApplets);
      const daysSinceEpoch = Math.floor(Date.now() / 8.64e7);
      // load all notification of past 2 days since epoch
      runningApplets.forEach((appletHash) => {
        const appletId = encodeHashToBase64(appletHash);
        this._mossStore.updateNotificationFeed(appletId, daysSinceEpoch);
        this._mossStore.updateNotificationFeed(appletId, daysSinceEpoch - 1);
      });
      this.notificationsLoading = false;
      console.log('Updated notifications.');
    } catch (e) {
      console.error('Failed to load notification feed: ', e);
    }
  }

  resetView() {
    this.view = WelcomePageView.Main;
  }

  renderExplanationCard() {
    return html`
      <sl-card style="flex: 1">
        <span class="title" slot="header">${msg('What is We?')}</span>
        <div class="column" style="text-align: left; font-size: 1.15em;">
          <span>${msg('We is a group collaboration OS.')}</span>
          <br />
          <span
            >${msg(
              'In We, first you create a group, and then you install applets to that group.',
            )}</span
          >
          <br />
          <span>${msg('You can see all the groups you are part of in the left sidebar.')}</span>
          <br />
          <span
            >${msg(
              'You can also see all the applets that you have installed in the top sidebar, if you have any.',
            )}</span
          >
          <br />
          <span
            >${msg(
              'WARNING! We is in alpha version, which means that is not ready for production use yet. Expect bugs, breaking changes, and to lose all the data for all groups when you upgrade to a new version of We.',
            )}</span
          >
        </div>
      </sl-card>
    `;
  }

  renderManagingGroupsCard() {
    return html`
      <sl-card style="flex: 1; margin-left: 16px">
        <span class="title" slot="header">${msg('Managing Groups')}</span>
        <div style="text-align: left; font-size: 1.15em;">
          <ol style="line-height: 180%; margin: 0;">
            <li>
              ${msg('To create a new group, click on the "Add Group"')}
              <sl-icon
                style="position: relative; top: 0.25em;"
                .src=${wrapPathInSvg(mdiAccountMultiplePlus)}
              ></sl-icon>
              ${msg('button in the left sidebar.')}
            </li>
            <li>
              ${msg(
                'After creating a group, create a profile for this group. Only the members of that group are going to be able to see your profile.',
              )}
            </li>
            <li>
              ${msg('Invite other members to the group by sharing the group link with them.')}
            </li>
            <li>${msg('Install applets that you want to use as a group.')}</li>
          </ol>
        </div>
      </sl-card>
    `;
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

  render() {
    switch (this.view) {
      case WelcomePageView.Main:
        return html`
          ${this.renderDisclaimerDialog()}
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
            <div class="row" style="flex-wrap: wrap; margin-top: 60px;">
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

            <div
              class="column"
              style="align-items: center; display:flex; flex: 1; margin-top: 40px; color: white;"
            >
              <h1>🏄 &nbsp;&nbsp;Moss Updates&nbsp;&nbsp; 🚧</h1>
              <span style="margin-top: 10px; margin-bottom: 30px; font-size: 18px;"
                >Thank you for surfing the edge of
                <a href="https://theweave.social" style="color: yellow;">the Weave</a>. Below are
                relevant updates for early weavers.</span
              >
              <div class="column">
                ${this.updateFeed.length === 0
                  ? html`No big waves lately...`
                  : this.updateFeed.map(
                      (message) => html`
                        <div class="update-feed-el">
                          <div class="update-date">${this.timeAgo.format(message.timestamp)}</div>
                          <div class="update-type">${message.type}</div>
                          ${unsafeHTML(Marked.parse(message.message))}
                        </div>
                      `,
                    )}
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
        background-color: rgba(57, 67, 51, 1);
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
        box-shadow: 0 0 2px 2px #202020;
        cursor: pointer;
      }

      .disclaimer-btn:hover {
        background: linear-gradient(#f2f98e, #b6c027);
      }

      .button-section {
        align-items: center;
        color: white;
        background: #ffffff1a;
        margin: 40px;
        padding: 30px;
        border-radius: 15px;
      }

      .update-feed-el {
        max-width: 800px;
        position: relative;
        padding: 20px;
        padding-top: 45px;
        border-radius: 10px;
        background: rgba(22, 35, 17, 1);
        margin: 5px;
        border: 2px solid;
        cursor: pointer;
        color: #fff;
        border: 2px solid rgba(96, 124, 4, 0.5);
        transition: all 0.25s ease;
        font-size: 18px;
        line-height: 1.4;
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
