import { css, html, LitElement } from 'lit';
import { GroupStore } from '../../groups/group-store.js';
import '../../groups/elements/applet-install-progress.js';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import { consume } from '@lit/context';
import { DnaHash, EntryHash } from '@holochain/client';
import { notify, notifyError } from '@holochain-open-dev/elements';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { mossStyles } from '../../shared-styles.js';
import { UnifiedToolEntry } from '../../types.js';
import { Applet } from '@theweave/group-client';
import {
  activeToolCurationConfigs,
  fetchUnifiedTools,
  findUnifiedToolByCompatibilityId,
  resolveUnifiedToolForApplet,
} from '../../tool-library/fetch-unified-tools.js';
import { toolLibraryFetch } from '../../tool-library/library-fetch.js';
import '../../ui/moss-dialog.js';
import { MossDialog } from '../../ui/moss-dialog.js';
import '../../tool-library/elements/library-tool-details.js';

export type ToolInfoInput =
  | { kind: 'activated-applet'; appletHash: EntryHash; applet: Applet }
  | { kind: 'activate-applet'; groupDnaHash: DnaHash; appletHash: EntryHash; applet: Applet }
  | { kind: 'unified'; tool: UnifiedToolEntry; installedAs?: string }
  | { kind: 'available-tool'; groupDnaHash: DnaHash; toolCompatibilityId: string };

/**
 * App-root–mounted dialog that shows informational tool details. Listens for the
 * bubbling `open-tool-info` custom event with `ToolInfoInput` in its detail.
 *
 * @element tool-info-dialog
 *
 * TODO(test): unit test deferred — see plans/tool-info-popup.md "TDD plan" #3.
 *   Cover the `open-tool-info` dispatch path for `kind: 'activated-applet'` and
 *   `kind: 'unified'`, including the "installed as" header line. E2E coverage
 *   for the activated-applet path lives in tests/e2e/smoke/10.tool-info-popup.spec.ts.
 */
@localized()
@customElement('tool-info-dialog')
export class ToolInfoDialog extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @query('#dialog')
  _dialog!: MossDialog;

  @state()
  private _resolvedTool: UnifiedToolEntry | undefined;

  @state()
  private _installedAs: string | undefined;

  @state()
  private _fallbackTitle: string | undefined;

  @state()
  private _fallbackSubtitle: string | undefined;

  @state()
  private _loading: boolean = false;

  /** Bumped on every show() so a slow background lookup cannot decorate a later dialog. */
  private _showToken = 0;

  /**
   * How the background tool-library lookup went. It separates "the library said
   * this Tool is not curated" from "the library could not be reached", which
   * read very differently to someone offline.
   */
  @state()
  private _detailsLookup: 'pending' | 'done' | 'unavailable' = 'done';

  // When set, the dialog shows an "Activate" action that joins this applet
  // (a peer registered it in the group but the local agent hasn't joined yet).
  @state()
  private _activateContext: { groupDnaHash: DnaHash; appletHash: EntryHash } | undefined;

  @state()
  private _activating: boolean = false;

  @state()
  private _activateGroupStore: GroupStore | undefined;

  // When set, the dialog shows a "Deactivate" action that disables this
  // (currently running) applet, turning it off without uninstalling it.
  @state()
  private _deactivateAppletHash: EntryHash | undefined;

  @state()
  private _deactivating: boolean = false;

  // The specific version + happ hash of the applet instance being shown. Lets a
  // user tell apart multiple installs of the same tool, including across
  // DNA-changing versions where the happ hash differs at the same tool version.
  @state()
  private _instanceDetails:
    | { version?: string; versionBranch?: string; happSha256?: string; installed: boolean }
    | undefined;

  // Cache the unified tools map so we don't re-fetch on every right-click.
  // Why: curation lists live on remote URLs. Keyed by a signature of the active
  // curation configs so a mid-session change to mossCurationConfig (via the URL
  // list manager) invalidates the cache automatically.
  private _unifiedToolsCache:
    | { signature: string; tools: Map<string, UnifiedToolEntry> }
    | undefined;

  async show(input: ToolInfoInput) {
    this._resolvedTool = undefined;
    this._detailsLookup = 'done';
    this._installedAs = undefined;
    this._fallbackTitle = undefined;
    this._fallbackSubtitle = undefined;
    this._activateContext = undefined;
    this._activating = false;
    this._deactivateAppletHash = undefined;
    this._deactivating = false;
    this._instanceDetails = undefined;

    // Synchronous-input path: resolve before showing to avoid a "Loading…" flicker frame.
    if (input.kind === 'unified') {
      this._resolvedTool = input.tool;
      this._installedAs = input.installedAs;
      this._loading = false;
      await this._dialog.show();
      return;
    }

    this._loading = true;
    await this._dialog.show();

    if (input.kind === 'activated-applet' || input.kind === 'activate-applet') {
      if (input.kind === 'activate-applet') {
        this._activateContext = {
          groupDnaHash: input.groupDnaHash,
          appletHash: input.appletHash,
        };
      } else {
        this._deactivateAppletHash = input.appletHash;
      }
      this._instanceDetails = this._instanceDetailsFromApplet(
        input.applet,
        input.kind === 'activated-applet',
      );
      this._fallbackTitle = input.applet.custom_name;
      this._fallbackSubtitle = input.applet.subtitle;
      // The Applet entry already carries everything the action needs, so the
      // dialog is usable at once; the tool library only refines title and icon
      // and is resolved in the background, if it can be reached at all.
      this._loading = false;
      this._detailsLookup = 'pending';
      const showToken = ++this._showToken;
      void this._ensureUnifiedTools()
        .then((map) => {
          if (showToken !== this._showToken) return;
          this._resolvedTool = resolveUnifiedToolForApplet(input.applet.distribution_info, map);
          this._installedAs =
            this._resolvedTool && this._resolvedTool.title !== input.applet.custom_name
              ? input.applet.custom_name
              : undefined;
          this._detailsLookup = toolLibraryFetch.isOffline() ? 'unavailable' : 'done';
        })
        .catch((e) => {
          if (showToken === this._showToken) this._detailsLookup = 'unavailable';
          console.warn('@tool-info-dialog: tool library unavailable: ', e);
        });
      return;
    }

    // 'available-tool' is reserved for the future first-run flow; resolve by
    // toolCompatibilityId across version branches.
    const map = await this._ensureUnifiedTools();
    this._resolvedTool = findUnifiedToolByCompatibilityId(map, input.toolCompatibilityId);
    this._loading = false;
  }

  async hide() {
    await this._dialog.hide();
  }

  private async _activate() {
    if (!this._activateContext) return;
    const { groupDnaHash, appletHash } = this._activateContext;
    this._activating = true;
    try {
      const groupStore = await this.mossStore.groupStore(groupDnaHash);
      if (!groupStore) throw new Error('No group store found for group.');
      this._activateGroupStore = groupStore;
      await groupStore.installApplet(appletHash);
      await this.mossStore.reloadManualStores();
      this.dispatchEvent(
        new CustomEvent('applet-installed', {
          detail: {
            appletEntryHash: appletHash,
            groupDnaHash,
          },
          composed: true,
          bubbles: true,
        }),
      );
      notify(msg('Tool activated.'));
      await this.hide();
    } catch (e) {
      notifyError(msg('Failed to activate tool (See console for details).'));
      console.error(e);
    }
    this._activating = false;
    this._activateGroupStore = undefined;
  }

  private async _deactivate() {
    if (!this._deactivateAppletHash) return;
    const appletHash = this._deactivateAppletHash;
    this._deactivating = true;
    try {
      await this.mossStore.disableApplet(appletHash);
      this.dispatchEvent(
        new CustomEvent('applet-disabled', {
          detail: { appletEntryHash: appletHash },
          composed: true,
          bubbles: true,
        }),
      );
      notify(msg('Tool deactivated.'));
      await this.hide();
    } catch (e) {
      notifyError(msg('Failed to deactivate tool (See console for details).'));
      console.error(e);
    }
    this._deactivating = false;
  }

  private _instanceDetailsFromApplet(applet: Applet, installed: boolean) {
    let version: string | undefined;
    let versionBranch: string | undefined;
    try {
      const distributionInfo = JSON.parse(applet.distribution_info);
      if (distributionInfo?.type === 'web2-tool-list') {
        version = distributionInfo.info.toolVersion;
        versionBranch = distributionInfo.info.versionBranch;
      }
    } catch (e) {
      console.warn('@tool-info-dialog: failed to parse distribution_info: ', e);
    }
    return { version, versionBranch, happSha256: applet.sha256_happ, installed };
  }

  private async _ensureUnifiedTools(): Promise<Map<string, UnifiedToolEntry>> {
    const configs = activeToolCurationConfigs(this.mossStore);
    const signature = JSON.stringify(configs);
    if (this._unifiedToolsCache && this._unifiedToolsCache.signature === signature) {
      return this._unifiedToolsCache.tools;
    }
    const result = await fetchUnifiedTools(configs, this.mossStore.devModeToolLibrary);
    // A result assembled while the library was unreachable is incomplete; keep
    // it uncached so the next open retries once the network is back.
    if (!toolLibraryFetch.isOffline()) {
      this._unifiedToolsCache = { signature, tools: result.unifiedTools };
    }
    return result.unifiedTools;
  }

  private renderHeader() {
    const title = this._resolvedTool?.title ?? this._fallbackTitle ?? msg('Tool info');
    return html`
      <span class="header">
        <span>${title}</span>
        ${this._installedAs
          ? html`<span class="installed-as">
              ${msg(str`(installed as: ${this._installedAs})`)}
            </span>`
          : ''}
      </span>
    `;
  }

  private renderBody() {
    if (this._loading) {
      return html`<div class="loading">${msg('Loading…')}</div>`;
    }
    if (this._resolvedTool) {
      return html`
        <library-tool-details
          .unifiedTool=${this._resolvedTool}
          .informational=${true}
        ></library-tool-details>
      `;
    }
    return html`
      <div class="column fallback">
        ${this._fallbackSubtitle
          ? html`<div class="fallback-subtitle">${this._fallbackSubtitle}</div>`
          : ''}
        <div class="fallback-note">${this.renderDetailsNote()}</div>
      </div>
    `;
  }

  private renderDetailsNote() {
    switch (this._detailsLookup) {
      case 'pending':
        return msg('Looking up Tool details…');
      case 'unavailable':
        return msg('Tool library unavailable — showing the details this group has.');
      case 'done':
        return msg('Limited info available — this tool is not in any active curation list.');
    }
  }

  private renderActionFooter() {
    if (this._loading) return '';
    if (this._activateContext) {
      return html`
        <div class="action-footer row">
          <button
            class="moss-button"
            ?disabled=${this._activating}
            @click=${() => this._activate()}
          >
            ${this._activating ? msg('Activating…') : msg('Activate')}
          </button>
        </div>
        ${this._activating
          ? html`<applet-install-progress
              style="margin-top: 10px;"
              .appletHash=${this._activateContext.appletHash}
              .groupStore=${this._activateGroupStore}
            ></applet-install-progress>`
          : ''}
      `;
    }
    if (this._deactivateAppletHash) {
      return html`
        <div class="action-footer row">
          <button
            class="moss-button-secondary"
            ?disabled=${this._deactivating}
            @click=${() => this._deactivate()}
          >
            ${this._deactivating ? msg('Deactivating…') : msg('Deactivate')}
          </button>
        </div>
      `;
    }
    return '';
  }

  private renderInstanceDetails() {
    const details = this._instanceDetails;
    if (!details) return '';
    if (!details.version && !details.happSha256) return '';
    return html`
      <div class="instance-details row">
        <span class="label">${details.installed ? msg('Installed version') : msg('Version')}:</span>
        <span class="value">${details.version ?? msg('unknown')}</span>
        ${details.versionBranch
          ? html`<span class="muted">${msg('branch')} ${details.versionBranch}</span>`
          : ''}
        ${details.happSha256
          ? html`<span class="muted" title=${details.happSha256}
              >happ ${details.happSha256.slice(0, 8)}…</span
            >`
          : ''}
      </div>
    `;
  }

  render() {
    return html`
      <moss-dialog id="dialog" width="780px" headerAlign="left">
        <span slot="header">${this.renderHeader()}</span>
        <div slot="content">
          ${this.renderInstanceDetails()}${this.renderBody()}${this.renderActionFooter()}
        </div>
      </moss-dialog>
    `;
  }

  static styles = [
    mossStyles,
    css`
      .header {
        display: inline-flex;
        align-items: baseline;
        gap: 8px;
      }
      .installed-as {
        font-size: 18px;
        font-weight: 400;
        opacity: 0.6;
      }
      .loading {
        padding: 30px;
      }
      .fallback {
        padding: 20px;
        gap: 10px;
      }
      .fallback-subtitle {
        font-size: 16px;
        opacity: 0.8;
      }
      .fallback-note {
        font-size: 13px;
        opacity: 0.6;
      }
      .action-footer {
        justify-content: flex-end;
        margin-top: 24px;
        padding-top: 20px;
        border-top: 1px solid var(--moss-grey-light);
      }
      .action-footer button {
        padding: 10px 28px;
        font-size: 16px;
        border-radius: 10px;
        white-space: nowrap;
      }
      .instance-details {
        align-items: baseline;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 14px;
        font-size: 13px;
      }
      .instance-details .label {
        opacity: 0.6;
      }
      .instance-details .value {
        font-weight: 600;
      }
      .instance-details .muted {
        opacity: 0.55;
        font-family: monospace;
      }
    `,
  ];
}

declare global {
  interface HTMLElementEventMap {
    'open-tool-info': CustomEvent<ToolInfoInput>;
  }
}
