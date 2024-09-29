import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { msg } from '@lit/localize';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import { ActionHash } from '@holochain/client';
import { hashProperty } from '@holochain-open-dev/elements';

import { MossStore } from '../../../moss-store.js';
import { mossStoreContext } from '../../../context.js';
import { weStyles } from '../../../shared-styles.js';
import { Tool, UpdateableEntity } from '@theweave/tool-library-client';

@customElement('tool-bundle-title')
export class AppletBundleTitle extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @property(hashProperty('tool-bundle-hash'))
  toolBundleHash!: ActionHash;

  toolBundle = new StoreSubscriber(
    this,
    () => this._mossStore.toolsLibraryStore.installableTools.get(this.toolBundleHash),
    () => [this.toolBundleHash],
  );

  renderTitle(toolBundle: UpdateableEntity<Tool> | undefined) {
    if (!toolBundle) return html`[Tool Record Not Found]`;

    return html` <div class="row">
      <img
        alt="${toolBundle.record.entry.title}"
        .src=${toolBundle.record.entry.icon}
        style="height: 16px; width: 16px; display: flex; margin-right: 4px"
      />
      <span style="color: rgb(119, 119, 119)">${toolBundle.record.entry.title}</span>
    </div>`;
  }

  render() {
    switch (this.toolBundle.value.status) {
      case 'pending':
        return html``;
      case 'complete':
        return this.renderTitle(this.toolBundle.value.value);
      case 'error':
        return html`<display-error
          tooltip
          .headline=${msg('Error fetching the information about the applet bundle')}
          .error=${this.toolBundle.value.error}
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
