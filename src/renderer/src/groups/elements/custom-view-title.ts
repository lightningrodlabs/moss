import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';
import { hashProperty } from '@holochain-open-dev/elements';
import { ActionHash } from '@holochain/client';
import { EntryRecord } from '@holochain-open-dev/utils';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { weStyles } from '../../shared-styles.js';
import { GroupStore } from '../group-store.js';
import { groupStoreContext } from '../context.js';
import { CustomView } from '../../custom-views/types.js';

@customElement('custom-view-title')
export class CustomViewTitle extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  /**
   * REQUIRED. The Hrl of the entry to render
   */
  @property(hashProperty('custom-view-hash'))
  customViewHash!: ActionHash;

  customView = new StoreSubscriber(
    this,
    () => this.groupStore.customViewsStore.customViews.get(this.customViewHash),
    () => [this.customViewHash],
  );

  renderTitle(customView: EntryRecord<CustomView> | undefined) {
    if (!customView) return html``;
    return html` <img
      alt="${customView.entry.name}"
        .src=${customView.entry.logo}
        style="height: 16px; width: 16px; border-radius: 2px; margin-right: 4px"
      ></img>
      <span style="color: rgb(119,119,119)">${customView.entry.name}</span>`;
  }

  render() {
    switch (this.customView.value.status) {
      case 'pending':
        return html``;
      case 'complete':
        return this.renderTitle(this.customView.value.value);
      case 'error':
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the custom view')}
          .error=${this.customView.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}
