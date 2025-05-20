import { customElement, state, query } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { localized } from '@lit/localize';
import { sharedStyles } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/popup/popup.js';
import '@theweave/elements/dist/elements/weave-client-context.js';

import { EntryHash } from '@holochain/client';
import { DnaHash } from '@holochain/client';
import { AppletInfo, AssetLocationAndInfo, GroupProfile, WAL } from '@theweave/api';
import './wal-element.js';
import './wal-created-element.js';
import './pocket-search.js';

export interface SearchResult {
  hrlsWithInfo: Array<[WAL, AssetLocationAndInfo]>;
  groupsProfiles: ReadonlyMap<DnaHash, GroupProfile>;
  appletsInfos: ReadonlyMap<EntryHash, AppletInfo>;
}

enum SidecarContent {
  Pocket,
  Palette,
}

/**
 * @element search-entry
 * @fires entry-selected - Fired when the user selects some entry. Detail will have this shape: { hrl, context }
 */
@localized()
@customElement('draggable-pocket')
export class DraggablePocket extends LitElement {
  @query('#draggable')
  draggableEl!: HTMLElement;

  @state()
  showContent = false;

  @state()
  showSidecar = false;

  @state()
  bottom: number = 20;

  @state()
  right: number = 20;

  @state()
  grabbing = false;

  @state()
  contentState: SidecarContent = SidecarContent.Pocket;

  newRight(e: MouseEvent) {
    const right = window.innerWidth - e.clientX - 30;
    if (right < -30) return -30;
    if (right > window.innerWidth - 30) return window.innerWidth - 30;
    return right;
  }

  newBottom(e: MouseEvent) {
    const bottom = window.innerHeight - e.clientY - 30;
    if (bottom < -30) return -30;
    if (bottom > window.innerHeight - 30) return window.innerHeight - 30;
    return bottom;
  }

  handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    this.grabbing = true;
    this.right = this.newRight(e);
    this.bottom = this.newBottom(e);

    const mouseMoveHandler = (e: MouseEvent) => {
      e.preventDefault();

      this.right = this.newRight(e);
      this.bottom = this.newBottom(e);
    };
    const mouseUpHandler = () => {
      document.removeEventListener('mouseup', mouseUpHandler);
      document.removeEventListener('mousemove', mouseMoveHandler);
      this.grabbing = false;
    };
    document.addEventListener('mouseup', mouseUpHandler);
    document.addEventListener('mousemove', mouseMoveHandler);
  }

  renderSidebarContent() {}

  render() {
    return html`
      <!-- a backdrop to listen for side-clicks and close the content -->
      ${this.showContent
        ? html`<div
            class="backdrop"
            @click=${() => {
              this.showContent = false;
            }}
          ></div>`
        : html``}

      <sl-popup placement="top" strategy="fixed" shift flip ?active=${this.showContent}>
        <div
          slot="anchor"
          id="draggable"
          class="column draggable"
          style="bottom: ${this.bottom}px; right: ${this.right}px;"
        >
          <div
            class="column menu-content"
            @click=${() => {
              console.log('SHOWING CONTENT');
              this.showContent = !this.showContent;
            }}
            @dragover=${() => {
              console.log('Dragging over menu.');
            }}
          >
            <div class="sidecar column"></div>
          </div>
          <div
            class="column center-content drag-handle ${this.grabbing ? 'grabbing' : ''}"
            @mousedown=${(e: MouseEvent) => this.handleMouseDown(e)}
          >
            <div style="width: 40px; height: 3px; background: black; margin-bottom: 5px;"></div>
            <div style="width: 40px; height: 3px; background: black; border-radius: 2px;"></div>
          </div>
        </div>

        <div class="column" style="background: red; width: 80px; height: 80px;">test</div>
      </sl-popup>
    `;
  }

  static get styles() {
    return [
      sharedStyles,
      css`
        .draggable {
          position: fixed;
          z-index: 999;
          height: 120px;
          width: 60px;
        }

        .menu-content {
          background: white;
          height: 80px;
          background: white;
          border-radius: 20px;
          position: relative;
        }

        .sidecar {
          position: absolute;
          width: 200px;
          height: 300px;
          border-radius: 20px;
          right: 100%;
          bottom: 0;
          background: blue;
        }

        .drag-handle {
          cursor: grab;
          height: 24px;
          width: 60px;
          border-radius: 20px;
          background: white;
        }

        .grabbing {
          cursor: grabbing;
        }
      `,
    ];
  }
}
