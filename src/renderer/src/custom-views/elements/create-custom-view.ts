import { LitElement, html, css } from 'lit';
import { state, property, query, customElement } from 'lit/decorators.js';
import { EntryRecord } from '@holochain-open-dev/utils';
import { notifyError, sharedStyles, onSubmit } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@holochain-open-dev/elements/dist/elements/select-avatar.js';

import 'grapes-editor';
import { GrapesEditor } from 'grapes-editor';
import { BlockProperties } from 'grapesjs';

import { CustomViewsStore } from '../custom-views-store.js';
import { customViewsStoreContext } from '../context.js';
import { CustomView } from '../types.js';

/**
 * @element create-custom-view
 * @fires custom-view-created: detail will contain { customViewHash }
 */
@localized()
@customElement('create-custom-view')
export class CreateCustomView extends LitElement {
  @property()
  blocks: Array<BlockProperties> = [];

  @query('grapes-editor')
  editor!: GrapesEditor;

  /**
   * @internal
   */
  @consume({ context: customViewsStoreContext, subscribe: true })
  customViewsStore!: CustomViewsStore;

  /**
   * @internal
   */
  @state()
  committing = false;

  /**
   * @internal
   */
  @query('form')
  form!: HTMLFormElement;

  async createCustomView(fields: any) {
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
      const record: EntryRecord<CustomView> =
        await this.customViewsStore.client.createCustomView(customView);

      this.dispatchEvent(
        new CustomEvent('custom-view-created', {
          composed: true,
          bubbles: true,
          detail: {
            customViewHash: record.actionHash,
          },
        }),
      );

      this.form.reset();
    } catch (e: any) {
      console.error(e);
      notifyError(msg('Error creating the custom view'));
    }
    this.committing = false;
  }

  render() {
    return html`
      <div class="column" style="flex: 1">
        <form
          class="row"
          ${onSubmit((f) => this.createCustomView(f))}
          style="align-items: center; padding: 16px; background-color: white"
        >
          <select-avatar
            label=""
            name="logo"
            required
            shape="rounded"
            style="margin-right: 8px"
          ></select-avatar>
          <sl-input name="name" required .placeholder=${msg('Custom View Name')}></sl-input>
          <span style="flex:1"> </span>
          <sl-button
            style="margin-right: 8px"
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent('create-cancelled', {
                  composed: true,
                  bubbles: true,
                }),
              )}
            >${msg('Cancel')}</sl-button
          >
          <sl-button variant="primary" type="submit" .loading=${this.committing}
            >${msg('Create Custom View')}</sl-button
          >
        </form>
        <grapes-editor .blocks=${this.blocks} style="flex: 1"></grapes-editor>
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
