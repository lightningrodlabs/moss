import { consume } from '@lit-labs/context';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { EntryHash } from '@holochain/client';
import { sharedStyles } from '@holochain-open-dev/elements';
import { BlockType } from '@lightningrodlabs/we-applet';
import { BlockProperties } from 'grapesjs';
import { asyncDeriveAndJoin, mapAndJoin, StoreSubscriber } from '@holochain-open-dev/stores';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import '../../custom-views/elements/create-custom-view.js';
import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { Applet } from '../../applets/types.js';
import { appletOrigin } from '../../utils.js';
import { WeStore } from '../../we-store.js';
import { weStoreContext } from '../../context.js';

@localized()
@customElement('create-custom-group-view')
export class CreateCustomGroupView extends LitElement {
  @consume({ context: weStoreContext })
  @state()
  weStore!: WeStore;

  @consume({ context: groupStoreContext, subscribe: true })
  @state()
  groupStore!: GroupStore;

  _blocks = new StoreSubscriber(
    this,
    () =>
      asyncDeriveAndJoin(this.groupStore.allBlocks, (allBlocks) =>
        mapAndJoin(allBlocks, (_, appletHash) => this.groupStore.applets.get(appletHash)),
      ),
    () => [this.groupStore],
  );

  renderContent(
    blocksByApplet: ReadonlyMap<EntryHash, Record<string, BlockType>>,
    applets: ReadonlyMap<EntryHash, Applet | undefined>,
  ) {
    const blocks: Array<BlockProperties> = [];

    for (const [appletHash, blockTypes] of Array.from(blocksByApplet.entries())) {
      for (const [blockName, block] of Object.entries(blockTypes)) {
        blocks.push({
          label: block.label,
          media: block.icon_src,
          category: applets.get(appletHash)?.custom_name,
          content: `<iframe src="${appletOrigin(this.weStore.conductorInfo, appletHash)}?view=${
            block.view
          }&view-type=block&block=${blockName}" style="width: 100%"></iframe>`,
        });
      }
    }

    return html`<create-custom-view .blocks=${blocks} style="flex: 1"></create-custom-view>`;
  }

  render() {
    switch (this._blocks.value.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'complete':
        return this.renderContent(this._blocks.value.value[0], this._blocks.value.value[1]);
      case 'error':
        console.error('Failed to fetch the blocks for this group: ', this._blocks.value.error);
        return html`<display-error
          .headline=${msg('Error fetching the blocks for this group')}
          .error=${this._blocks.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}
