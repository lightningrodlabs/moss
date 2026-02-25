import { customElement, query, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import { notifyError, wrapPathInSvg } from '@holochain-open-dev/elements';
import { CellType, encodeHashToBase64, ProvisionedCell } from '@holochain/client';
import { Applet, JoinAppletInput } from '@theweave/group-client';
import { v4 as uuidv4 } from 'uuid';

import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { groupStoreContext } from '../../../groups/context.js';
import { GroupStore } from '../../../groups/group-store.js';
import { mossStyles } from '../../../shared-styles.js';
import { cloneIcon, doorIcon } from '../icons.js';
import { mdiPowerPlugOffOutline } from '@mdi/js';
import { dialogMessagebox } from '../../../electron-api.js';
import { progenitorFromProperties } from '../../../utils.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio/radio.js';
import { MossDialog } from '../moss-dialog.js';
import '../moss-dialog.js';

@localized()
@customElement('danger-zone')
export class DangerTone extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  @state()
  leaving = false;

  @state()
  cloning = false;

  @state()
  cloneStep = '';

  @state()
  cloneError = '';

  @state()
  _cloneNameInput = '';

  @state()
  _cloneSourceHasProgenitor = false;

  @state()
  _cloneUseProgenitor = false;

  _cloneNameResolver: ((result: { name: string; useProgenitor: boolean } | null) => void) | null =
    null;

  _requestCloneOptions(
    defaultName: string,
    sourceHasProgenitor: boolean,
  ): Promise<{ name: string; useProgenitor: boolean } | null> {
    this._cloneNameInput = defaultName;
    this._cloneSourceHasProgenitor = sourceHasProgenitor;
    this._cloneUseProgenitor = sourceHasProgenitor;
    this._cloneNameDialog.show();
    return new Promise((resolve) => {
      this._cloneNameResolver = resolve;
    });
  }

  get dialog(): MossDialog {
    return this.shadowRoot?.getElementById('leave-group-dialog') as MossDialog;
  }

  @query('#clone-name-dialog')
  _cloneNameDialog!: MossDialog;

  async leaveGroup() {
    const confirmation = await dialogMessagebox({
      message:
        'WARNING: Leaving a group will refresh Moss. Save any unsaved content in Tools of other groups before you proceed.',
      type: 'warning',
      buttons: ['Cancel', 'Continue'],
    });
    if (confirmation.response === 0) return;
    this.leaving = true;

    const groupDnaHash = this._groupStore.groupDnaHash;
    try {
      await this._mossStore.leaveGroup(groupDnaHash);
      window.location.reload();
    } catch (e) {
      notifyError(msg('Error leaving the group'));
      console.error(e);
    }

    this.leaving = false;
  }

  async cloneGroup() {
    this.cloning = false;
    this.cloneError = '';
    this.cloneStep = '';

    // First, read the group profile and detect progenitor before opening the dialog
    let defaultGroupName = 'New Group';
    let sourceHasProgenitor = false;
    try {
      const rec = await this._groupStore.groupClient.getGroupProfile(false);
      if (rec) defaultGroupName = rec.entry.name;
    } catch (_) {}
    try {
      const installedApps = await this._mossStore.adminWebsocket.listApps({});
      const myGroupDnaHashB64 = encodeHashToBase64(this._groupStore.groupDnaHash);
      const groupCell = installedApps
        .filter((appInfo) => appInfo.installed_app_id.startsWith('group#'))
        .flatMap((appInfo) => appInfo.cell_info['group'] ?? [])
        .find(
          (cell) =>
            cell.type === CellType.Provisioned &&
            encodeHashToBase64(cell.value.cell_id[0]) === myGroupDnaHashB64,
        );
      if (groupCell && groupCell.type === CellType.Provisioned) {
        const progenitor = progenitorFromProperties(groupCell.value.dna_modifiers.properties);
        sourceHasProgenitor = !!progenitor;
      }
    } catch (_) {}

    const result = await this._requestCloneOptions(defaultGroupName, sourceHasProgenitor);
    if (result === null) return;
    const { name: newName, useProgenitor } = result;

    this.cloning = true;
    this.cloneStep = msg('Reading group profile...');
    this.cloneError = '';
    try {
      // 1. Get current group profile and description
      const groupProfileRecord = await this._groupStore.groupClient.getGroupProfile(false);
      if (!groupProfileRecord) throw new Error('Could not read group profile.');
      const groupProfile = { ...groupProfileRecord.entry, name: newName };
      const groupDescriptionRecord = await this._groupStore.groupClient.getGroupDescription(false);
      const groupDescription = groupDescriptionRecord?.entry.data;

      // 2. Get list of applet hashes in this group
      this.cloneStep = msg('Reading installed tools...');
      const appletHashes = await this._groupStore.groupClient.getMyJoinedAppletsHashes();

      // 3. Fetch the full Applet entry for each hash
      const applets: Array<Applet> = [];
      for (const hash of appletHashes) {
        const applet = await this._groupStore.groupClient.getApplet(hash);
        if (applet) {
          applets.push(applet);
        }
      }

      // 4. Create new group with the same name and icon
      this.cloneStep = msg(`Creating new group "${newName}"...`);
      const newGroupAppInfo = await this._mossStore.createGroup(
        newName,
        groupProfile.icon_src,
        useProgenitor,
      );

      // 5. Get the new group store
      const newGroupDnaHash = (newGroupAppInfo.cell_info['group'][0].value as ProvisionedCell)
        .cell_id[0];
      const newGroupStore = await this._mossStore.groupStore(newGroupDnaHash);
      if (!newGroupStore) throw new Error('Failed to get new group store after creation.');

      // 5b. Copy description if present
      if (groupDescription) {
        await newGroupStore.groupClient.setGroupDescription(undefined, groupDescription);
      }

      // 6. Install each tool in the new group with a fresh network seed
      for (let i = 0; i < applets.length; i++) {
        const originalApplet = applets[i];
        this.cloneStep = msg(
          `Installing tool "${originalApplet.custom_name}" (${i + 1}/${applets.length})...`,
        );

        const newApplet: Applet = {
          ...originalApplet,
          network_seed: uuidv4(),
          permission_hash: undefined,
        };

        const newAppletHash = await newGroupStore.groupClient.hashApplet(newApplet);
        const appInfo = await this._mossStore.installApplet(newAppletHash, newApplet);

        const joinInput: JoinAppletInput = {
          applet: newApplet,
          joining_pubkey: appInfo.agent_pub_key,
        };
        await newGroupStore.groupClient.registerAndJoinApplet(joinInput);
      }

      this.cloneStep = msg('Done. Reloading...');
      window.location.reload();
    } catch (e) {
      notifyError(msg('Error cloning group'));
      console.error(e);
      this.cloneError = String(e);
      this.cloning = false;
      this.cloneStep = '';
    }
  }

  renderCloneNameDialog() {
    return html`
      <moss-dialog
        id="clone-name-dialog"
        width="480px"
        headerAlign="center"
        @sl-request-close=${(e: CustomEvent) => {
          e.preventDefault();
          this._cloneNameDialog.hide();
          if (this._cloneNameResolver) {
            this._cloneNameResolver(null);
            this._cloneNameResolver = null;
          }
        }}
      >
        <span slot="header">${msg('Clone Group')}</span>
        <div slot="content">
          <div style="margin-bottom: 16px;">
            ${msg('Enter a name for the new group. It will be created with the same tools but fresh (empty) data.')}
          </div>
          <sl-input
            autofocus
            class="moss-input"
            .value=${this._cloneNameInput}
            @sl-input=${(e: CustomEvent) =>
              (this._cloneNameInput = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' && this._cloneNameInput.trim()) {
                this._cloneNameDialog.hide();
                if (this._cloneNameResolver) {
                  this._cloneNameResolver({
                    name: this._cloneNameInput.trim(),
                    useProgenitor: this._cloneUseProgenitor,
                  });
                  this._cloneNameResolver = null;
                }
              } else if (e.key === 'Escape') {
                this._cloneNameDialog.hide();
                if (this._cloneNameResolver) {
                  this._cloneNameResolver(null);
                  this._cloneNameResolver = null;
                }
              }
            }}
          ></sl-input>
          ${this._cloneSourceHasProgenitor
            ? html`
                <div style="margin-top: 20px; margin-bottom: 4px; font-weight: 600;">
                  ${msg('Group stewardship')}
                </div>
                <div style="font-size: 13px; opacity: 0.7; margin-bottom: 10px;">
                  ${msg(
                    'The group you are cloning is stewarded. Would you like the new group to be stewarded? You will be set as the steward, but can add others later.',
                  )}
                </div>
                <sl-radio-group
                  .value=${this._cloneUseProgenitor ? 'stewarded' : 'unstewarded'}
                  @sl-change=${(e: CustomEvent) => {
                    this._cloneUseProgenitor = (e.target as HTMLInputElement).value === 'stewarded';
                  }}
                >
                  <sl-radio value="stewarded">${msg('Stewarded (with steward)')}</sl-radio>
                  <sl-radio value="unstewarded">${msg('Unstewarded (open)')}</sl-radio>
                </sl-radio-group>
              `
            : html``}
          <div class="row" style="margin-top: 20px; justify-content: end;">
            <sl-button
              @click=${() => {
                this._cloneNameDialog.hide();
                if (this._cloneNameResolver) {
                  this._cloneNameResolver(null);
                  this._cloneNameResolver = null;
                }
              }}
              >${msg('Cancel')}</sl-button
            >
            <sl-button
              style="margin-left: 8px;"
              variant="primary"
              ?disabled=${!this._cloneNameInput.trim()}
              @click=${() => {
                this._cloneNameDialog.hide();
                if (this._cloneNameResolver) {
                  this._cloneNameResolver({
                    name: this._cloneNameInput.trim(),
                    useProgenitor: this._cloneUseProgenitor,
                  });
                  this._cloneNameResolver = null;
                }
              }}
              >${msg('Clone')}</sl-button
            >
          </div>
        </div>
      </moss-dialog>
    `;
  }

  renderLeaveGroupDialog() {
    return html`<moss-dialog
      id="leave-group-dialog"
      width="674px"
      headerAlign="center"
      .label=${msg('Leave Group')}
      @sl-request-close=${(e) => {
        if (this.leaving) {
          e.preventDefault();
        }
      }}
    >
      <span slot="header">${msg('Leave Group')}</span>
      <div slot="content">
        <div>${msg('Are you sure you want to leave this group?')}</div>
        <br />
        <div class="row items-center">
          <div style="margin-right: 10px;">⚠️</div>
          <div>
            <b
              >${msg(
        'This will delete all your data related to this group and the Tools you joined therein from your computer.',
      )}</b
            >
            <span
              >${msg(
        'Other members of the group can keep using the group and any Tools they joined themselves.',
      )}</span
            >
          </div>
        </div>
        <div class="row" style="margin-top:10px; justify-content: end">
          <sl-button @click=${() => this.dialog.hide()}>${msg('Cancel')}</sl-button>
          <sl-button
            style="margin-left:8px"
            variant="danger"
            .loading=${this.leaving}
            @click=${() => this.leaveGroup()}
            >${msg('Leave')}</sl-button
          >
        </div>
      </div>
    </moss-dialog>`;
  }

  render() {
    return html`
      ${this.renderCloneNameDialog()}
      ${this.renderLeaveGroupDialog()}
      <div class="column" style="margin-top: 40px;">
        <div class="row items-center" style="margin-bottom: 20px;">
          <button
            class="moss-button"
            style="min-height: 22px; min-width: 160px; padding: 8px 12px; text-align: center;"
            @click=${async () => {
        this.dispatchEvent(
          new CustomEvent('disable-group', {
            detail: this._groupStore.groupDnaHash,
            bubbles: true,
            composed: true,
          }),
        );
      }}
          >
            <div class="column center-content">
              <sl-icon
                style="margin-bottom: 4px; font-size: 1.3rem;"
                .src=${wrapPathInSvg(mdiPowerPlugOffOutline)}
              ></sl-icon>
              <div>${msg('Disable Group')}</div>
            </div>
          </button>
          <div style="margin-left: 40px;">
            ${msg(
              'Disables this group for yourself and you will stop synchronizing data with other members of this group. You can re-enable it again later.',
            )}
          </div>
        </div>
        <div class="row items-center" style="margin-bottom: 20px;">
          <button
            class="moss-button center-content leave-group-button"
            @click=${() => this.dialog.show()}
          >
            <div class="column center-content">
              <div>${doorIcon(20)}</div>
              <div style="margin-top: 4px;">${msg('Leave Group')}</div>
            </div>
          </button>
          <div style="margin-left: 40px;">
            ${msg(
              'Leave the group forever. You cannot join it again with this instance of Moss and all your data associated to this group and its Tools will be deleted from your computer. Other members of the group can keep using the group and any Tools they joined.',
            )}
          </div>
        </div>
        <div class="row items-center">
          <button
            class="moss-button center-content clone-button"
            ?disabled=${this.cloning}
            @click=${() => this.cloneGroup()}
          >
            <div class="column center-content">
              <div>${cloneIcon(20)}</div>
              <div style="margin-top: 4px;">${this.cloning ? msg('Cloning...') : msg('Clone Group')}</div>
            </div>
          </button>
          <div style="margin-left: 40px;">
            ${msg(
              'Clone the group. This will create a new group with the same Tools as this one, but with a different group DNA. You can then choose to leave the original group and keep using the cloned one.',
            )}
          </div>
        </div>
        ${this.cloning
          ? html`
              <div
                class="column"
                style="margin-top: 16px; padding: 12px; background: #1a1a2e; border-radius: 8px; border: 1px solid #444;"
              >
                <div style="font-weight: bold; margin-bottom: 8px;">${msg('Cloning group...')}</div>
                <div style="color: #aaa;">${this.cloneStep}</div>
              </div>
            `
          : this.cloneError
            ? html`
                <div
                  style="margin-top: 16px; padding: 12px; background: #2e1a1a; border-radius: 8px; border: 1px solid #aa4444; color: #ff8888;"
                >
                  <b>${msg('Clone failed:')}</b> ${this.cloneError}
                </div>
              `
            : html``}
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }
      button.moss-button {
        min-height: 22px;
        min-width: 160px; 
        padding: 8px 12px; 
        text-align: center;
      }
      button.leave-group-button {
        background: #b70000;
        color: white;
      }
      button.leave-group-button:hover {
        background: #ff0000;
      }
      button.clone-button {
        background: #00b728;
        color: white;
      }
      button.clone-button:hover:not(:disabled) {
        background: #00ff2a;
      }
      button.clone-button:disabled {
        background: #3a5a3c;
        color: #888;
        cursor: not-allowed;
      }
    `,
  ];
}
