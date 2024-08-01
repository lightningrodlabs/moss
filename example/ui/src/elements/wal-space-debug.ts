import { css, html, LitElement, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  AppletInfo,
  AssetLocationAndInfo,
  encodeContext,
  GroupProfile,
  WAL,
  stringifyHrl,
  WeaveLocation,
  WeaveUrl,
  weaveUrlToLocation,
  WeaveClient,
  weaveUrlFromWal,
} from '@lightningrodlabs/we-applet';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import { sharedStyles, wrapPathInSvg } from '@holochain-open-dev/elements';
import { DnaHash } from '@holochain/client';
import { localized, msg } from '@lit/localize';
import {
  mdiArrowCollapse,
  mdiArrowExpand,
  mdiClose,
  mdiNoteEdit,
  mdiOpenInNew,
  mdiPlus,
} from '@mdi/js';
import { ref, createRef, Ref } from 'lit/directives/ref.js';
import 'lit-moveable';

export type Position = {
  x: number;
  y: number;
};
export type Size = {
  width: number;
  height: number;
};
export type AssetSpec = {
  position: Position;
  size?: Size;
  weaveUrl: WeaveUrl;
};

@localized()
@customElement('wal-space')
export class WalSpace extends LitElement {
  @state()
  wals: AssetSpec[] = [];

  @state()
  appletInfo: AppletInfo | undefined;

  @state()
  groupProfiles: ReadonlyMap<DnaHash, GroupProfile> | undefined;

  @state()
  editing: boolean = false;

  async firstUpdated() {}

  toggleEdit() {
    this.editing = !this.editing;
  }

  targetRef: Ref<HTMLDivElement> = createRef();

  async addWal() {
    const wal = await window.__WEAVE_API__.userSelectWal();
    if (wal) {
      this.wals = [...this.wals, { weaveUrl: weaveUrlFromWal(wal), position: { x: 0, y: 0 } }];
    }
  }
  draggable: any = true;
  throttleDrag: any = 1;
  edgeDraggable: any = true;
  startDragRotate: any = 2;
  throttleDragRotate: any = 0;
  onDrag(e: any) {
    console.log('FISH');
    e.target.style.transform = e.transform;
  }
  onDragStart(e: any) {
    console.log('FISH');
  }
  onResize(e: any) {
    e.target.style.width = `${e.width}px`;
    e.target.style.height = `${e.height}px`;
    e.target.style.transform = e.drag.transform;
  }

  renderContent() {
    // const embeds: TemplateResult[] = [];
    // this.wals.forEach((w) => embeds.push(html` <wal-embed .src=${w.weaveUrl} bare> </wal-embed> `));
    // return embeds;
    return html`
      <div class="moveable-container" style="position:relative">
        <div class="target" style="width:100;height:40px;" ${ref(this.targetRef)}>Target</div>
        <lit-moveable
          .target=${'.target'}
          .resizable=${true}
          .origin=${true}
          .litDraggable=${this.draggable}
          .throttleDrag=${this.throttleDrag}
          .edgeDraggable=${this.edgeDraggable}
          .startDragRotate=${this.startDragRotate}
          .throttleDragRotate=${this.throttleDragRotate}
          @litDrag=${this.onDrag}
          @litDragStart=${this.onDragStart}
          @litResize=${this.onResize}
        ></lit-moveable>
      </div>
    `;
  }

  renderHeader() {
    return html`
      <div class="top-bar row" style="align-items: center;">
        ${this.appletInfo
          ? html`
              <div
                class="row"
                style="align-items: center; ${this.groupProfiles
                  ? 'border-right: 2px solid black;'
                  : ''}"
              >
                <sl-tooltip .content=${this.appletInfo.appletName}>
                  <img
                    style="height: 26px; margin-right: 4px; border-radius: 3px;"
                    .src=${this.appletInfo.appletIcon}
                  />
                </sl-tooltip>
              </div>
            `
          : html``}
        ${this.groupProfiles
          ? html` <div class="row" style="align-items: center; margin-left: 4px;">
              ${Array.from(this.groupProfiles.values()).map(
                (groupProfile) => html`
                  <sl-tooltip .content=${groupProfile.name}>
                    <img
                      src=${groupProfile.icon_src}
                      style="height: 26px; width: 26px; border-radius: 50%; margin-right: 2px;"
                    />
                  </sl-tooltip>
                `
              )}
            </div>`
          : html``}
        <sl-tooltip .content=${msg('Edit')}>
          <div
            class="column center-content open-btn"
            tabindex="0"
            @click=${async () => await this.toggleEdit()}
            @keypress=${async (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                await this.toggleEdit();
              }
            }}
          >
            <sl-icon .src=${wrapPathInSvg(mdiNoteEdit)} style="font-size: 24px;"></sl-icon>
          </div>
        </sl-tooltip>
        <sl-tooltip .content=${msg('Add Wall')}>
          <div
            class="column center-content open-btn"
            tabindex="0"
            @click=${async () => await this.addWal()}
            @keypress=${async (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                await this.addWal();
              }
            }}
          >
            <sl-icon .src=${wrapPathInSvg(mdiPlus)} style="font-size: 24px;"></sl-icon>
          </div>
        </sl-tooltip>
      </div>
    `;
  }
  render() {
    return html` <div class="container">${this.renderHeader()} ${this.renderContent()}</div> `;
  }

  static styles = [
    sharedStyles,
    css`
      .container {
        border-right: 2px solid #8595bf;
        border-left: 2px solid #8595bf;
        border-bottom: 2px solid #8595bf;
        border-radius: 3px;
        resize: both;
        font-family: 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;
      }

      .top-bar {
        height: 30px;
        background: #8595bf;
        position: relative;
      }
    `,
  ];
}
