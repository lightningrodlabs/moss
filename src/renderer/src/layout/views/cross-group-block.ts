import { html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { IframeKind, RenderView } from '@theweave/api';
import { consume } from '@lit/context';
import { localized } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';

import './view-frame.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { weStyles } from '../../shared-styles.js';
import { ToolCompatibilityId } from '@theweave/moss-types';

@localized()
@customElement('cross-group-block')
export class CrossGroupBlock extends LitElement {
  @property()
  toolCompatibilityId!: ToolCompatibilityId;

  @property()
  block!: string;

  @property()
  context!: any;

  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  render() {
    const renderView: RenderView = {
      type: 'cross-group-view',
      view: {
        type: 'block',
        block: this.block,
        context: this.context,
      },
    };
    const iframeKind: IframeKind = {
      type: 'cross-group',
      toolCompatibilityId: this.toolCompatibilityId,
    };
    return html`<view-frame .renderView=${renderView} .iframeKind=${iframeKind}> </view-frame>`;
  }

  static styles = [weStyles];
}
