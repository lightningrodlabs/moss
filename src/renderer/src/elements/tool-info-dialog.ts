import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import { consume } from '@lit/context';
import { DnaHash, EntryHash } from '@holochain/client';

import { mossStoreContext } from '../context.js';
import { MossStore } from '../moss-store.js';
import { mossStyles } from '../shared-styles.js';
import { UnifiedToolEntry } from '../types.js';
import { Applet } from '@theweave/group-client';
import {
  activeToolCurationConfigs,
  fetchUnifiedTools,
  findUnifiedToolByCompatibilityId,
  resolveUnifiedToolForApplet,
} from '../personal-views/tool-library/fetch-unified-tools.js';
import './_new_design/moss-dialog.js';
import { MossDialog } from './_new_design/moss-dialog.js';
import '../personal-views/tool-library/elements/library-tool-details.js';

export type ToolInfoInput =
  | { kind: 'activated-applet'; appletHash: EntryHash; applet: Applet }
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
 *   (smoke #10) is specced on the feat/tool-info-popup branch (PR #210) and
 *   lands with the Playwright harness.
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

  // Cache the unified tools map so we don't re-fetch on every right-click.
  // Why: curation lists live on remote URLs. Keyed by a signature of the active
  // curation configs so a mid-session change to mossCurationConfig (via the URL
  // list manager) invalidates the cache automatically.
  private _unifiedToolsCache:
    | { signature: string; tools: Map<string, UnifiedToolEntry> }
    | undefined;

  async show(input: ToolInfoInput) {
    this._resolvedTool = undefined;
    this._installedAs = undefined;
    this._fallbackTitle = undefined;
    this._fallbackSubtitle = undefined;

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

    if (input.kind === 'activated-applet') {
      this._fallbackTitle = input.applet.custom_name;
      this._fallbackSubtitle = input.applet.subtitle;
      const map = await this._ensureUnifiedTools();
      this._resolvedTool = resolveUnifiedToolForApplet(input.applet.distribution_info, map);
      this._installedAs =
        this._resolvedTool && this._resolvedTool.title !== input.applet.custom_name
          ? input.applet.custom_name
          : undefined;
      this._loading = false;
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

  private async _ensureUnifiedTools(): Promise<Map<string, UnifiedToolEntry>> {
    const configs = activeToolCurationConfigs(this.mossStore);
    const signature = JSON.stringify(configs);
    if (this._unifiedToolsCache && this._unifiedToolsCache.signature === signature) {
      return this._unifiedToolsCache.tools;
    }
    const result = await fetchUnifiedTools(configs, this.mossStore.devModeToolLibrary);
    this._unifiedToolsCache = { signature, tools: result.unifiedTools };
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
        <div class="fallback-note">
          ${msg('Limited info available — this tool is not in any active curation list.')}
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <moss-dialog id="dialog" width="780px" headerAlign="left">
        <span slot="header">${this.renderHeader()}</span>
        <div slot="content">${this.renderBody()}</div>
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
    `,
  ];
}

declare global {
  interface HTMLElementEventMap {
    'open-tool-info': CustomEvent<ToolInfoInput>;
  }
}
