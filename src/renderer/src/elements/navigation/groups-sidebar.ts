import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { pipe, StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { GroupProfile } from '@theweave/api';
import { localized, msg } from '@lit/localize';
import { DnaHash, DnaHashB64, encodeHashToBase64 } from '@holochain/client';
import { mdiPowerPlugOffOutline, mdiTimerSand } from '@mdi/js';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../../groups/elements/group-context.js';
import './sidebar-button.js';
import './group-sidebar-button.js';
import '../dialogs/create-group-dialog.js';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { mossStyles } from '../../shared-styles.js';
import { PersistedStore } from '../../persisted-store.js';
import { plusIcon } from '../_new_design/icons.js';

@localized()
@customElement('groups-sidebar')
export class GroupsSidebar extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  _groupsProfiles = new StoreSubscriber(
    this,
    () => this._mossStore.allGroupsProfiles,
    () => [this._mossStore],
  );

  _disabledGroups = new StoreSubscriber(
    this,
    () =>
      pipe(this._mossStore.disabledGroups, async (disabledGroups) => {
        const hashesAndProfiles: [DnaHash, GroupProfile | undefined][] = [];
        await Promise.all(
          disabledGroups.map(async (dnaHash) => {
            const groupProfile = await this._mossStore.groupProfile(encodeHashToBase64(dnaHash));
            hashesAndProfiles.push([dnaHash, groupProfile]);
          }),
        );
        return hashesAndProfiles;
      }),
    () => [this._mossStore],
  );

  @property()
  selectedGroupDnaHash?: DnaHash;

  @property()
  indicatedGroupDnaHashes: DnaHashB64[] = [];

  @state()
  dragged: DnaHashB64 | null = null;

  firstUpdated() {}

  renderGroups(
    groups: ReadonlyMap<DnaHash, GroupProfile | undefined>,
    disabledGroups: [DnaHash, GroupProfile | undefined][],
  ) {
    const knownGroups = Array.from(groups.entries()).filter(
      ([_, groupProfile]) => !!groupProfile,
    ) as Array<[DnaHash, GroupProfile]>;
    const unknownGroups = Array.from(groups.entries()).filter(
      ([_, groupProfile]) => !groupProfile,
    ) as Array<[DnaHash, GroupProfile]>;

    let customGroupOrder = this._mossStore.persistedStore.groupOrder.value();
    if (!customGroupOrder) {
      customGroupOrder = knownGroups
        .sort(([_, a], [__, b]) => a.name.localeCompare(b.name))
        .map(([hash, _profile]) => encodeHashToBase64(hash));
      this._mossStore.persistedStore.groupOrder.set(customGroupOrder);
    }
    knownGroups.forEach(([hash, _]) => {
      if (!customGroupOrder!.includes(encodeHashToBase64(hash))) {
        customGroupOrder!.splice(0, 0, encodeHashToBase64(hash));
      }
      this._mossStore.persistedStore.groupOrder.set(customGroupOrder!);
      this.requestUpdate();
    });

    return html`
      <div style="height: 10px;"></div>
      <div
        class="column center-content dropzone"
        style="position: absolute; top: 82px;"
        @dragenter=${(e: DragEvent) => {
          (e.target as HTMLElement).classList.add('active');
        }}
        @dragleave=${(e: DragEvent) => {
          (e.target as HTMLElement).classList.remove('active');
        }}
        @dragover=${(e: DragEvent) => {
          e.preventDefault();
        }}
        @drop=${(e: DragEvent) => {
          e.preventDefault();
          const dropGroupHash = undefined;
          storeNewOrder(this.dragged!, dropGroupHash);
          this.requestUpdate();
        }}
      >
        <div class="dropzone-indicator"></div>
      </div>
      ${knownGroups
        .sort(
          ([a_hash, _a], [b_hash, _b]) =>
            customGroupOrder!.indexOf(encodeHashToBase64(a_hash)) -
            customGroupOrder!.indexOf(encodeHashToBase64(b_hash)),
        )
        .map(
          ([groupDnaHash, groupProfile]) => html`
            <group-context .groupDnaHash=${groupDnaHash} .debug=${true}>
              <div style="height: 70px; position: relative; margin: 0; padding: 0;">
                <group-sidebar-button
                  id="${`groupIcon#${encodeHashToBase64(groupDnaHash)}`}"
                  draggable="true"
                  @dragstart=${(e: DragEvent) => {
                    (e.target as HTMLElement).classList.add('dragging');
                    this.dragged = encodeHashToBase64(groupDnaHash);
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
                      el.classList.remove('active');
                    });
                    this.dragged = null;
                  }}
                  .selected=${this.selectedGroupDnaHash &&
                  groupDnaHash.toString() === this.selectedGroupDnaHash.toString()}
                  .indicated=${this.indicatedGroupDnaHashes.includes(
                    encodeHashToBase64(groupDnaHash),
                  )}
                  .logoSrc=${groupProfile.icon_src}
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
                  class="column center-content dropzone below"
                  @dragenter=${(e: DragEvent) => {
                    (e.target as HTMLElement).classList.add('active');
                  }}
                  @dragleave=${(e: DragEvent) => {
                    (e.target as HTMLElement).classList.remove('active');
                  }}
                  @dragover=${(e: DragEvent) => {
                    e.preventDefault();
                  }}
                  @drop=${(e: DragEvent) => {
                    e.preventDefault();
                    const dropGroupHash = (
                      e.target as HTMLElement
                    ).previousElementSibling!.id.slice(10);
                    storeNewOrder(this.dragged!, dropGroupHash);
                    this.requestUpdate();
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
            style="margin-bottom: -4px;"
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
      ${disabledGroups.map(
        ([groupDnaHash, groupProfile]) => html`
          <sidebar-button
            style="margin-bottom: -4px; opacity: 0.6;"
            .selected=${this.selectedGroupDnaHash &&
            groupDnaHash.toString() === this.selectedGroupDnaHash.toString()}
            .indicated=${this.indicatedGroupDnaHashes.includes(encodeHashToBase64(groupDnaHash))}
            .logoSrc=${groupProfile?.icon_src
              ? groupProfile.icon_src
              : wrapPathInSvg(mdiPowerPlugOffOutline)}
            .slIcon=${groupProfile?.icon_src ? false : true}
            .tooltipText=${groupProfile?.name
              ? `${groupProfile.name} (${msg('disabled')})`
              : msg('Disabled Group')}
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
            style="width: 48px; height: 48px; margin-bottom: 16px; margin-top: 15px; --border-radius: 8px;"
          ></sl-skeleton>
          <sl-skeleton
            effect="pulse"
            style="width: 48px; height: 48px; margin-bottom: 16px; --border-radius: 8px;"
          ></sl-skeleton>
          <sl-skeleton
            effect="pulse"
            style="width: 48px; height: 48px; margin-bottom: 16px; --border-radius: 8px;"
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
        switch (this._disabledGroups.value.status) {
          case 'error':
            console.error('Failed to load disabled groups: ', this._disabledGroups.value.error);
            return this.renderGroups(this._groupsProfiles.value.value, []);
          case 'pending':
            return this.renderGroups(this._groupsProfiles.value.value, []);
          case 'complete':
            return this.renderGroups(
              this._groupsProfiles.value.value,
              this._disabledGroups.value.value,
            );
        }
    }
  }

  render() {
    return html`
      <div class="column sidebar">
        ${this.renderGroupsLoading()}

        <sl-tooltip placement="right" .content=${msg('Add Group')} hoist>
          <button class="moss-sidebar-button"
            style="margin-top: 10px;"
            size="large"
            circle
            @click=${() => {
              this.dispatchEvent(
                new CustomEvent('request-add-group', {
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
          >
            <div class="column center-content" style="height: 100%;">
              ${plusIcon(26)}
            </div>
          </sl-button>
        </sl-tooltip>
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        flex-direction: column;
        align-items: center;
        display: flex;
      }

      .sidebar {
        align-items: center;
      }

      .dropzone {
        height: 4px;
        width: 58px;
        left: 8px;
        padding: 4px 0;
        z-index: 1;
      }

      .below {
        position: absolute;
        bottom: -8px;
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

      .sidebar {
        padding-bottom: 10px;
      }

      /* .add-group-button {
        all: unset;
        color: white;
        background: var(--moss-dark-button);
        border-radius: 12px;
        cursor: pointer;
        height: 58px;
        width: 58px;
      }

      .add-group-button:hover {
        background: var(--moss-purple-semi-transparent);
      }

      .add-group-button:focus-visible {
        outline: 2px solid var(--moss-purple);
      } */
    `,
  ];
}

function storeNewOrder(draggedHash: DnaHashB64, droppedHash: DnaHashB64 | undefined) {
  if (draggedHash === droppedHash) return;
  // TODO potentially make this more resilient and remove elements of deleted groups
  const persistedStore = new PersistedStore();
  const customGroupOrder = persistedStore.groupOrder.value();
  const currentIdx = customGroupOrder.indexOf(draggedHash);
  customGroupOrder.splice(currentIdx, 1);
  const newIdx = droppedHash ? customGroupOrder.indexOf(droppedHash) + 1 : 0;
  customGroupOrder.splice(newIdx, 0, draggedHash);
  persistedStore.groupOrder.set(customGroupOrder);
}
