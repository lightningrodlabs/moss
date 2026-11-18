import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import '@shoelace-style/shoelace/dist/components/details/details.js';

import { mossStyles } from './shared-styles';
import {
  CAL_URL,
  COPYRIGHT_HOLDER,
  COPYRIGHT_START_YEAR,
  HOLOCHAIN_URL,
  PackageNotice,
  ThirdPartyNotices,
  copyrightYears,
  parseNotices,
} from './about/about-content';

declare const __MOSS_BUILD_YEAR__: number;

type AboutInfo = {
  mossVersion: string;
  holochainVersion: string;
  hasChromiumNotices: boolean;
};

type AboutElectronAPI = {
  aboutInfo: () => Promise<AboutInfo>;
  openChromiumNotices: () => Promise<void>;
};

const electronAPI = (window as unknown as { electronAPI: AboutElectronAPI }).electronAPI;

@localized()
@customElement('moss-about')
export class MossAbout extends LitElement {
  @state() private info: AboutInfo | undefined;
  @state() private notices: ThirdPartyNotices | undefined;
  @state() private noticesMissing = false;

  async firstUpdated() {
    this.info = await electronAPI.aboutInfo();
    try {
      const res = await fetch('third-party-notices.json');
      this.notices = res.ok ? parseNotices(await res.json()) : undefined;
    } catch {
      this.notices = undefined;
    }
    this.noticesMissing = !this.notices;
  }

  private renderPackage(p: PackageNotice) {
    const license = p.license === 'UNKNOWN' ? msg('License not declared') : p.license;
    return html`
      <li>
        <details>
          <summary>
            <span class="pkg-name">${p.name}</span>
            <span class="pkg-version">${p.version}</span>
            <span class="pkg-license">${license}</span>
          </summary>
          ${p.url ? html`<a href=${p.url} target="_blank">${p.url}</a>` : ''}
          ${p.text
            ? html`<pre>${p.text}</pre>`
            : html`<p class="muted">${msg('This package does not include a license file.')}</p>`}
        </details>
      </li>
    `;
  }

  private renderNotices() {
    if (this.noticesMissing) {
      // Only reachable in a dev checkout that skipped `yarn setup`/`yarn build`.
      return html`<p class="muted">third-party-notices.json is missing: run yarn gen:notices</p>`;
    }
    if (!this.notices) return html``;
    return html`
      <h3>${msg('Bundled programs')}</h3>
      <ul class="notices">
        ${this.notices.binaries.map(
          (b) => html`
            <li class="binary">
              <span class="pkg-name">${b.name}</span>
              <span class="pkg-license">${b.license}</span>
              <div class="muted">${b.copyright}</div>
              <a href=${b.url} target="_blank">${b.url}</a>
            </li>
          `,
        )}
      </ul>
      ${this.info?.hasChromiumNotices
        ? html`<button class="moss-button" @click=${() => electronAPI.openChromiumNotices()}>
            ${msg('Open Chromium and Electron notices')}
          </button>`
        : ''}
      <h3>${msg(str`Libraries (${this.notices.packages.length})`)}</h3>
      <ul class="notices">
        ${this.notices.packages.map((p) => this.renderPackage(p))}
      </ul>
    `;
  }

  render() {
    const years = copyrightYears(COPYRIGHT_START_YEAR, __MOSS_BUILD_YEAR__);
    return html`
      <div class="column about">
        <img class="moss-icon" src="icon.png" alt="" />
        <h1>Moss</h1>
        ${this.info
          ? html`<div class="muted">
              ${msg(str`Version ${this.info.mossVersion}`)} · Holochain
              ${this.info.holochainVersion}
            </div>`
          : ''}
        <p class="copyright">
          © ${years} ${COPYRIGHT_HOLDER}<br />
          ${msg('License:')}
          <a href=${CAL_URL} target="_blank">Cryptographic Autonomy License 1.0</a>
        </p>

        <a class="powered-by" href=${HOLOCHAIN_URL} target="_blank">
          <span>${msg('Powered by')}</span>
          <img src="holochain-logo.png" alt="Holochain" />
        </a>

        <sl-details class="notices-section" summary=${msg('Third-party notices')}>
          ${this.renderNotices()}
        </sl-details>
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
        flex: 1;
        overflow-y: auto;
      }
      .about {
        align-items: center;
        text-align: center;
        padding: 24px;
        gap: 8px;
        width: 100%;
        box-sizing: border-box;
      }
      .moss-icon {
        width: 80px;
        height: 80px;
        border-radius: 20px;
        box-shadow: 0 2px 8px rgba(21, 26, 17, 0.3);
        margin-bottom: 8px;
      }
      h1 {
        margin: 0;
        color: var(--Moss-dark-button, #151a11);
        font-family: 'Mossville-v2';
        font-size: 48px;
        font-weight: 400;
        line-height: 91%;
        letter-spacing: -1.44px;
      }
      .muted {
        color: #666;
        font-size: 13px;
      }
      .copyright {
        margin: 8px 0;
        line-height: 1.5;
      }
      .powered-by {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        margin: 8px 0 16px;
        color: inherit;
        text-decoration: none;
        font-size: 13px;
      }
      .powered-by img {
        width: 220px;
      }
      .notices-section {
        width: 100%;
        text-align: left;
      }
      h3 {
        margin: 16px 0 8px;
        font-size: 15px;
      }
      ul.notices {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      ul.notices li {
        padding: 4px 0;
        border-bottom: 1px solid #e3e3e3;
        font-size: 13px;
        overflow-wrap: anywhere;
      }
      summary {
        cursor: pointer;
      }
      .pkg-name {
        font-weight: 600;
      }
      .pkg-version {
        color: #666;
        margin-left: 4px;
      }
      .pkg-license {
        float: right;
        color: #444;
      }
      pre {
        white-space: pre-wrap;
        font-size: 11px;
        background: #f5f5f5;
        padding: 8px;
        max-height: 240px;
        overflow-y: auto;
      }
    `,
  ];
}
