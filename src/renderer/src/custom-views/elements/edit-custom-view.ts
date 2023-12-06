import { LitElement, html, css } from 'lit';
import { state, customElement, property, query } from 'lit/decorators.js';
import { EntryRecord } from '@holochain-open-dev/utils';
import { notifyError, sharedStyles, onSubmit } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { BlockProperties } from 'grapesjs';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import 'grapes-editor';
import { GrapesEditor } from 'grapes-editor';

import { CustomViewsStore } from '../custom-views-store.js';
import { customViewsStoreContext } from '../context.js';
import { CustomView } from '../types.js';

/**
 * @element edit-custom-view
 * @fires custom-view-updated: detail will contain { previousCustomViewHash, updatedCustomViewHash }
 */
@localized()
@customElement('edit-custom-view')
export class EditCustomView extends LitElement {
  @property()
  blocks: Array<BlockProperties> = [];

  // REQUIRED. The current CustomView record that should be updated
  @property()
  currentRecord!: EntryRecord<CustomView>;

  /**
   * @internal
   */
  @consume({ context: customViewsStoreContext })
  customViewsStore!: CustomViewsStore;

  /**
   * @internal
   */
  @state()
  committing = false;

  @query('grapes-editor')
  editor!: GrapesEditor;

  firstUpdated() {
    this.shadowRoot?.querySelector('form')!.reset();
  }

  async updateCustomView(fields: any) {
    if (this.committing) return;

    const editor = this.editor.editor;

    const css = editor.getCss();
    const js = editor.getJs();
    const html = editor.getHtml();

    const customView: CustomView = {
      logo: fields.logo,
      name: fields.name,
      html,
      js,
      css: css || '',
    };

    try {
      this.committing = true;
      const updateRecord = await this.customViewsStore.client.updateCustomView(
        this.currentRecord.actionHash,
        customView,
      );

      this.dispatchEvent(
        new CustomEvent('custom-view-updated', {
          composed: true,
          bubbles: true,
          detail: {
            previousCustomViewHash: this.currentRecord.actionHash,
            updatedCustomViewHash: updateRecord.actionHash,
          },
        }),
      );
    } catch (e: any) {
      console.error(e);
      notifyError(msg('Error updating the custom view'));
    }

    this.committing = false;
  }

  render() {
    return html`
      <div class="column" style="flex: 1">
        <form
          class="row"
          ${onSubmit((f) => this.updateCustomView(f))}
          style="align-items: center; padding: 16px; background-color: white"
        >
          <select-avatar
            name="logo"
            label=""
            required
            shape="rounded"
            style="margin-right: 8px"
            .defaultValue=${this.currentRecord.entry.logo}
          ></select-avatar>
          <sl-input
            name="name"
            required
            .placeholder=${msg('Custom View Name')}
            .defaultValue=${this.currentRecord.entry.name}
          ></sl-input>
          <span style="flex:1"> </span>
          <sl-button
            style="margin-right: 8px"
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent('edit-cancelled', {
                  composed: true,
                  bubbles: true,
                }),
              )}
            >${msg('Cancel')}</sl-button
          >
          <sl-button variant="primary" type="submit" .loading=${this.committing}
            >${msg('Save')}</sl-button
          >
        </form>
        <grapes-editor
          .template=${this.currentRecord.entry}
          .blocks=${this.blocks}
          style="flex: 1"
        ></grapes-editor>
      </div>
    `;
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
