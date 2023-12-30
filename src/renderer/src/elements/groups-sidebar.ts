import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { GroupProfile } from '@lightningrodlabs/we-applet';
import { localized, msg } from '@lit/localize';
import { DnaHash, DnaHashB64, encodeHashToBase64 } from '@holochain/client';
import { mdiAccountMultiplePlus, mdiTimerSand } from '@mdi/js';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../groups/elements/group-context.js';
import './sidebar-button.js';
import './group-sidebar-button.js';
import './create-group-dialog.js';

import { weStoreContext } from '../context.js';
import { WeStore } from '../we-store.js';
import { weStyles } from '../shared-styles.js';

@localized()
@customElement('groups-sidebar')
export class GroupsSidebar extends LitElement {
  @consume({ context: weStoreContext, subscribe: true })
  _weStore!: WeStore;

  _groupsProfiles = new StoreSubscriber(
    this,
    () => this._weStore.allGroupsProfiles,
    () => [this._weStore],
  );

  @property()
  selectedGroupDnaHash?: DnaHash;

  @property()
  indicatedGroupDnaHashes: DnaHashB64[] = [];

  renderGroups(groups: ReadonlyMap<DnaHash, GroupProfile | undefined>) {
    const knownGroups = Array.from(groups.entries()).filter(
      ([_, groupProfile]) => !!groupProfile,
    ) as Array<[DnaHash, GroupProfile]>;
    const unknownGroups = Array.from(groups.entries()).filter(
      ([_, groupProfile]) => !groupProfile,
    ) as Array<[DnaHash, GroupProfile]>;

    return html`
      <div style="height: 10px;"></div>
      ${knownGroups
        .sort(([_, a], [__, b]) => a.name.localeCompare(b.name))
        .map(
          ([groupDnaHash, groupProfile]) => html`
            <group-context .groupDnaHash=${groupDnaHash} .debug=${true}>
              <div style="height: 70px; position: relative; margin: 0; padding: 0;">
                <group-sidebar-button
                  draggable="true"
                  @dragstart=${(e: DragEvent) => {
                    (e.target as HTMLElement).classList.add('dragging');
                  }}
                  @dragend=${(e: DragEvent) => {
                    (e.target as HTMLElement).classList.remove('dragging');
                    Array.from(
                      (
                        e.target as HTMLElement
                      ).parentElement!.parentElement!.parentElement!.getElementsByClassName(
                        'dropzone',
                      ),
                    ).forEach((el) => {
                      console.log('@dragend el: ', el);
                      console.log('@dragend el.classList: ', el.classList);
                      el.classList.remove('active');
                    });
                    console.log('dragend.');
                  }}
                  style="border-radius: 50%; --size: 58px;"
                  .selected=${this.selectedGroupDnaHash &&
                  groupDnaHash.toString() === this.selectedGroupDnaHash.toString()}
                  .indicated=${this.indicatedGroupDnaHashes.includes(
                    encodeHashToBase64(groupDnaHash),
                  )}
                  .logoSrc=${groupProfile.logo_src}
                  .tooltipText=${groupProfile.name}
                  @click=${() => {
                    this.dispatchEvent(
                      new CustomEvent('group-selected', {
                        detail: {
                          groupDnaHash,
                        },
                        bubbles: true,
                        composed: true,
                      }),
                    );
                  }}
                ></group-sidebar-button>
                <div
                  class="column center-content dropzone"
                  @dragenter=${(e: DragEvent) => {
                    console.log('@dragenter: e.target: ', e.target);
                    (e.target as HTMLElement).classList.add('active');
                  }}
                  @dragleave=${(e: DragEvent) => {
                    console.log('@dragleave: e.target: ', e.target);
                    (e.target as HTMLElement).classList.remove('active');
                  }}
                  @dragover=${(e: DragEvent) => {
                    e.preventDefault();
                    console.log('dragover');
                  }}
                >
                  <div class="dropzone-indicator"></div>
                </div>
              </div>
            </group-context>
          `,
        )}
      ${unknownGroups.map(
        ([groupDnaHash]) => html`
          <sidebar-button
            style="margin-bottom: -4px; border-radius: 50%; --size: 58px;"
            .selected=${this.selectedGroupDnaHash &&
            groupDnaHash.toString() === this.selectedGroupDnaHash.toString()}
            .indicated=${this.indicatedGroupDnaHashes.includes(encodeHashToBase64(groupDnaHash))}
            .logoSrc=${wrapPathInSvg(mdiTimerSand)}
            .slIcon=${true}
            .tooltipText=${msg('Waiting for peers...')}
            @click=${() => {
              this.dispatchEvent(
                new CustomEvent('group-selected', {
                  detail: {
                    groupDnaHash,
                  },
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
          ></sidebar-button>
        `,
      )}
    `;
  }

  renderGroupsLoading() {
    switch (this._groupsProfiles.value.status) {
      case 'pending':
        return html`
          <sl-skeleton
            effect="pulse"
            style="width: 60px; height: 58px; margin-bottom: 10px;"
          ></sl-skeleton>
          <sl-skeleton
            effect="pulse"
            style="width: 60px; height: 58px; margin-bottom: 10px;"
          ></sl-skeleton>
          <sl-skeleton
            effect="pulse"
            style="width: 60px; height: 58px; margin-bottom: 10px;"
          ></sl-skeleton>
        `;
      case 'error':
        console.error('Error displaying the groups: ', this._groupsProfiles.value.error);
        return html`<display-error
          .headline=${msg('Error displaying the groups')}
          tooltip
          .error=${this._groupsProfiles.value.error}
        ></display-error>`;
      case 'complete':
        return this.renderGroups(this._groupsProfiles.value.value);
    }
  }

  render() {
    return html`
      <div class="column sidebar">
        ${this.renderGroupsLoading()}

        <sl-tooltip placement="right" .content=${msg('Add Group')} hoist>
          <sl-button
            size="large"
            circle
            @click=${() => {
              this.dispatchEvent(
                new CustomEvent('request-create-group', {
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
            style="margin-top: 8px;"
          >
            <div class="column center-content" style="height: 100%;">
              <sl-icon
                style="width: 25px; height: 25px;"
                .src=${wrapPathInSvg(mdiAccountMultiplePlus)}
              ></sl-icon>
            </div>
          </sl-button>
        </sl-tooltip>
      </div>
    `;
  }

  static styles = [
    weStyles,
    css`
      :host {
        flex-direction: column;
        align-items: center;
        display: flex;
      }

      .sidebar {
        padding-top: 12px;
        align-items: center;
      }

      .dropzone {
        position: absolute;
        bottom: -28px;
        height: 4px;
        width: 58px;
        left: 8px;
        border-radius: 2px;
        padding: 24px 0;
      }

      .dragging {
        opacity: 0.4;
      }

      .dropzone-indicator {
        /* width: 100%;
        background: var(--sl-color-primary-100);
        height: 4px;
        border-radius: 2px;
        display: none; */
        position: absolute;
        left: -12px;
        width: 0;
        height: 0;
        border-top: 10px solid transparent;
        border-left: 20px solid var(--sl-color-primary-100);
        border-bottom: 10px solid transparent;
        display: none;
      }

      .active .dropzone-indicator {
        display: block;
      }
    `,
  ];
}
