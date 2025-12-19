import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { EntryHash } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../../groups/elements/group-context.js';
import '../../applets/elements/applet-logo.js';
import '../dialogs/create-group-dialog.js';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { mossStyles } from '../../shared-styles.js';
import { AppletStore } from '../../applets/applet-store.js';
import { toolCompatibilityIdFromDistInfoString } from '@theweave/utils';
import { ToolCompatibilityId } from '@theweave/api';

@localized()
@customElement('applets-sidebar')
export class AppletsSidebar extends LitElement {
  @consume({ context: mossStoreContext })
  _mossStore!: MossStore;

  _applets = new StoreSubscriber(
    this,
    () => this._mossStore.allRunningApplets,
    () => [],
  );

  renderApplets(applets: ReadonlyMap<EntryHash, AppletStore>) {
    const appletsByToolId: Record<ToolCompatibilityId, AppletStore> = {};

    for (const [_appletHash, appletStore] of Array.from(applets.entries())) {
      const toolId = toolCompatibilityIdFromDistInfoString(appletStore.applet.distribution_info);
      if (!appletsByToolId[toolId]) {
        appletsByToolId[toolId] = appletStore;
      }
    }

    return html`
      <div class="row" style="align-items:center">
        ${Object.entries(appletsByToolId)
          .sort((a1, a2) => a1[1].applet.custom_name.localeCompare(a2[1].applet.custom_name))
          .map(
            ([toolId, appletStore]) => html`
              <sl-tooltip hoist placement="bottom" .content=${appletStore.applet.custom_name}>
                <applet-logo
                  .appletHash=${appletStore.appletHash}
                  @click=${() => {
                    this.dispatchEvent(
                      new CustomEvent('tool-selected', {
                        detail: {
                          toolCompatibilityId: toolId,
                        },
                        bubbles: true,
                        composed: true,
                      }),
                    );
                  }}
                  style="cursor: pointer; margin-top: 2px; margin-bottom: 2px; margin-right: 12px; --size: 58px"
                ></applet-logo>
              </sl-tooltip>
            `,
          )}
      </div>
    `;
  }

  renderAppletsLoading() {
    switch (this._applets.value.status) {
      case 'pending':
        return html`<sl-skeleton
            style="height: 58px; width: 58px; --border-radius: 8px; border-radius: 8px; margin-right: 10px;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 58px; width: 58px; --border-radius: 8px; border-radius: 8px; margin-right: 10px;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 58px; width: 58px; --border-radius: 8px; border-radius: 8px; margin-right: 10px;"
            effect="pulse"
          ></sl-skeleton> `;
      case 'error':
        return html`<display-error
          .headline=${msg('Error displaying the applets')}
          tooltip
          .error=${this._applets.value.error}
        ></display-error>`;
      case 'complete':
        return this.renderApplets(this._applets.value.value);
    }
  }

  render() {
    return html`
      <div class="row" style="flex: 1; padding: 4px; align-items: center;">
        ${this.renderAppletsLoading()}
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}
