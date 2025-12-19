import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized } from '@lit/localize';
import { IframeKind, RenderView, ToolCompatibilityId } from '@theweave/api';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';

import './view-frame.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { mossStyles } from '../../shared-styles.js';

@localized()
@customElement('cross-group-main')
export class CrossGroupMain extends LitElement {
  @property()
  toolCompatibilityId!: ToolCompatibilityId;

  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @property()
  hostColor: string | undefined;

  hostStyle() {
    if (this.hostColor) {
      return html`
        <style>
          :host {
            background: ${this.hostColor};
          }
        </style>
      `;
    }
    return html``;
  }

  render() {
    const renderView: RenderView = {
      type: 'cross-group-view',
      view: {
        type: 'main',
      },
    };
    const iframeKind: IframeKind = {
      type: 'cross-group',
      toolCompatibilityId: this.toolCompatibilityId,
      subType: 'main',
    };
    return html` ${this.hostStyle()}
      <view-frame
        class="elevated"
        .renderView=${renderView}
        .iframeKind=${iframeKind}
        style="flex: 1;"
      >
      </view-frame>`;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
        padding: 8px;
        border-radius: 5px 0 0 0;
      }

      .elevated {
        border-radius: 5px;
        filter: drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.5));
        overflow: hidden;
      }
    `,
  ];
}
