import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { ActionHash, ActionHashB64, AgentPubKey, EntryHash, encodeHashToBase64 } from '@holochain/client';
import { localized, msg } from '@lit/localize';
import { ref } from 'lit/directives/ref.js';
import { joinAsyncMap, pipe, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { notify, notifyError, onSubmit } from '@holochain-open-dev/elements';
import {GetonlyMap, slice} from '@holochain-open-dev/utils';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';

import { groupStoreContext } from '../../../groups/context.js';
import { mossStyles } from '../../../shared-styles.js';
import { GroupStore } from '../../../groups/group-store.js';
import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { ToolAndCurationInfo } from '../../../types.js';
import { MossDialog } from '../../../elements/_new_design/moss-dialog.js';
import '../../../elements/_new_design/moss-dialog.js';
import {Applet, AppletAgent} from "@theweave/group-client";
import { toolCompatibilityIdFromDistInfoString } from '@theweave/utils';
import { DistributionInfo, TDistributionInfo, ToolInfoAndVersions } from '@theweave/moss-types';
import { Value } from '@sinclair/typebox/value';
import { getLocalizedTimeAgo } from '../../../locales/localization.js';
import { toolSettingsStyles } from '../../../elements/_new_design/group-settings/tool-settings-styles.js';

type MatchingInactiveTool = {
  toolHash: EntryHash;
  toolName: string;
  installerKey: AgentPubKey;
  timestamp: number;
  joinedMembers: AppletAgent[];
  toolInfoAndVersions: ToolInfoAndVersions | undefined;
};

@localized()
@customElement('install-tool-dialog-web2')
export class InstallToolDialogWeb2 extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  _registeredApplets = new StoreSubscriber(
    this,
    () =>
      pipe(this.groupStore.allAdvertisedApplets, (allAppletsHashes) =>
            joinAsyncMap(slice(this.groupStore.applets as GetonlyMap<any, any>, allAppletsHashes)),
      ),
    () => [this.groupStore],
  );

  @query('#applet-dialog')
  _appletDialog!: MossDialog;

  @query('form')
  form!: HTMLFormElement;

  @state()
  _dnaBundle: { hash: ActionHashB64; file: File } | undefined = undefined;

  @state()
  _uiBundle: { hash: ActionHashB64; setupRenderers: any } | undefined = undefined;

  @state()
  _invalidUiBundle = false;

  @state()
  _duplicateName: boolean = false;

  @state()
  _installing: boolean = false;

  @state()
  _installationProgress: string | undefined;

  @state()
  _tool: ToolAndCurationInfo | undefined;

  @state()
  _showAdvanced: boolean = false;

  @state()
  _showDuplicateWarning: boolean = false;

  @state()
  _matchingInactiveTool: MatchingInactiveTool | undefined;

  @state()
  _activatingExisting: boolean = false;

  groupProfile = new StoreSubscriber(
    this,
    () => this.groupStore.groupProfile,
    () => [this.groupStore],
  );
  // _unlisten: UnlistenFn | undefined;

  async open(tool: ToolAndCurationInfo) {
    // reload all advertised applets
    await this.groupStore.allAdvertisedApplets.reload();
    this._tool = tool;
    this._matchingInactiveTool = undefined;
    this._activatingExisting = false;

    // Check for matching inactive tool before showing the dialog
    const match = await this.findMatchingInactiveTool();
    if (match) {
      this._matchingInactiveTool = match;
      this._showDuplicateWarning = true;
    } else {
      this._showDuplicateWarning = false;
    }

    setTimeout(() => {
      if (!this._showDuplicateWarning) {
        this.form?.reset();
      }
      this._appletDialog.show();
    }, 200);
  }

  close() {
    this.form?.reset();
    this._tool = undefined;
    this._showDuplicateWarning = false;
    this._matchingInactiveTool = undefined;
    this._appletDialog.hide();
    this.dispatchEvent(
      new CustomEvent('install-tool-dialog-closed', {
        composed: true,
        bubbles: true,
      }),
    );
  }

  // disconnectedCallback(): void {
  //   if (this._unlisten) this._unlisten();
  // }

  get publishDisabled() {
    return this._duplicateName;
  }

  // TODO: Use MossPrivilege instead
  async checkPrivileges(): Promise<[boolean, ActionHash | undefined]> {
    const myAccountabilities = await toPromise(this.groupStore.myAccountabilities);
    let hash: ActionHash | undefined = undefined;
    let isPriv = false;
    for (const acc of myAccountabilities) {
      if (acc.type === 'Steward') {
        hash = acc.content.permission_hash;
        isPriv = true;
        continue;
      }
      if (acc.type == 'Progenitor') {
        isPriv = true;
        continue;
      }
    }
    return [isPriv, hash];
  }

  async findMatchingInactiveTool(): Promise<MatchingInactiveTool | undefined> {
    if (!this._tool) return undefined;
    try {
      const unjoinedApplets = await toPromise(this.groupStore.unjoinedApplets);
      const ignoredApplets = this.mossStore.persistedStore.ignoredApplets.value(
        encodeHashToBase64(this.groupStore.groupDnaHash),
      );
      const targetCompatibilityId = this._tool.toolCompatibilityId;

      for (const [appletHash, [agentKey, timestamp]] of unjoinedApplets.entries()) {
        const hashB64 = encodeHashToBase64(appletHash);
        if (ignoredApplets && ignoredApplets.includes(hashB64)) continue;

        try {
          const appletEntry = await toPromise(this.groupStore.applets.get(appletHash)!);
          if (!appletEntry) continue;
          const compatibilityId = toolCompatibilityIdFromDistInfoString(
            appletEntry.distribution_info,
          );
          if (compatibilityId === targetCompatibilityId) {
            // Fetch tool info for display
            let toolInfoAndVersions: ToolInfoAndVersions | undefined;
            try {
              const distributionInfo: DistributionInfo = JSON.parse(appletEntry.distribution_info);
              Value.Assert(TDistributionInfo, distributionInfo);
              if (distributionInfo.type === 'web2-tool-list') {
                toolInfoAndVersions = await this.mossStore.toolInfoFromRemote(
                  distributionInfo.info.toolListUrl,
                  distributionInfo.info.toolId,
                  distributionInfo.info.versionBranch,
                );
              }
            } catch (e) {
              console.warn('Failed to fetch tool info for inactive tool:', e);
            }
            let joinedMembers: AppletAgent[] = [];
            try {
              joinedMembers = await toPromise(this.groupStore.joinedAppletAgents.get(appletHash)!);
            } catch (e) {
              console.warn('Failed to get joined members for inactive tool:', e);
            }
            return {
              toolHash: appletHash,
              toolName: appletEntry.custom_name,
              installerKey: agentKey,
              timestamp,
              joinedMembers,
              toolInfoAndVersions,
            };
          }
        } catch (e) {
          console.warn('Failed to check inactive tool compatibility:', e);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch unjoined applets for duplicate check:', e);
    }
    return undefined;
  }

  async activateExistingTool() {
    if (!this._matchingInactiveTool) return;
    this._activatingExisting = true;
    try {
      await this.groupStore.installApplet(this._matchingInactiveTool.toolHash);
      await this.mossStore.reloadManualStores();
      notify(msg('Tool activated.'));
      this.dispatchEvent(
        new CustomEvent('applet-installed', {
          detail: {
            appletEntryHash: this._matchingInactiveTool.toolHash,
            groupDnaHash: this.groupStore.groupDnaHash,
          },
          composed: true,
          bubbles: true,
        }),
      );
      this.close();
    } catch (e) {
      notifyError('Failed to activate tool (See console for details).');
      console.error(e);
    }
    this._activatingExisting = false;
  }

  async proceedWithNewInstall() {
    this._showDuplicateWarning = false;
    this._matchingInactiveTool = undefined;
    // Wait for the form to render in the DOM before resetting it
    await this.updateComplete;
    this.form?.reset();
  }

  async installApplet(fields: { custom_name: string; network_seed?: string }) {
    if (this._installing) return;
    if (!this._tool) {
      notifyError('Tool undefined.');
      throw new Error('Tool undefined.');
    }

    this._installing = true;
    try {
      // Trigger the download of the icon
      // TODO convert icon to base64 and store it on disk
      this._installationProgress = 'Checking permission type...';
      const [isPriv, permission_hash] = await this.checkPrivileges();
      if (!isPriv) {
        console.error('No valid permission to add a Tool to this group.');
        notifyError('No valid permission to add a Tool to this group.');
        this._appletDialog.hide();
        this._installing = false;
        this._installationProgress = undefined;
        return;
      }
      this._installationProgress = 'Downloading and installing Tool...';
      const appletEntryHash = await this.groupStore.installAndAdvertiseApplet(
        this._tool,
        fields.custom_name,
        fields.network_seed ? fields.network_seed : undefined,
        permission_hash
      );

      // Add a timeout here to try to fix case where error "Applet not installed in any of the groups" occurs
      setTimeout(() => {
        notify(msg('Installation successful'));
        this.close();
        this.dispatchEvent(
          new CustomEvent('applet-installed', {
            detail: {
              appletEntryHash,
              groupDnaHash: this.groupStore.groupDnaHash,
            },
            composed: true,
            bubbles: true,
          }),
        );
        this._appletDialog.hide();
        this._installing = false;
        this._installationProgress = undefined;
      }, 200);
    } catch (e) {
      this._installationProgress = undefined;
      notifyError('Installation failed! (See console for details)');
      console.error(`Installation error: ${e}`);
      this._installing = false;
    }
  }

  renderDuplicateWarning() {
    const info = this._matchingInactiveTool;
    if (!info) return html``;
    const timeAgo = getLocalizedTimeAgo();

    return html`
      <div class="column" style="gap: 20px;">
        <div class="form-text" style="font-size: 16px; line-height: 1.5;">
          ${msg('That tool has already been added to the group.')}
          ${msg('Are you sure you want to create another instance of that tool?')}
        </div>

        <div class="column tool" style="flex: 1;">
          <div class="row" style="justify-content: space-between">
            <div class="row">
              ${info.toolInfoAndVersions?.icon
                ? html`<sl-tooltip content="${info.toolInfoAndVersions.description}">
                    <img
                      src=${info.toolInfoAndVersions.icon}
                      alt=${msg("Tool logo")}
                      style="height: 64px; width:64px; margin-right: 10px; border-radius:16px;"
                    />
                  </sl-tooltip>`
                : html``}
              <div class="column">
                <span class="tool-name">${info.toolName}</span>
                <span class="tool-short-description">${info.toolInfoAndVersions?.subtitle}</span>
              </div>
            </div>
          </div>
          <div class="details-container column">
            <div class="installer row">
              <agent-avatar
                .size=${24}
                style="margin-right: 5px;"
                .agentPubKey=${info.installerKey}
              ></agent-avatar>
              <span>${msg('installed this tool to the group space ')}</span>
              <div style="margin-left:5px;">
                ${timeAgo.format(new Date(info.timestamp / 1000))}
              </div>
            </div>
            ${info.joinedMembers.length > 0
              ? html`<div class="participants row">
                  <span style="margin-right: 5px;">${msg('In use by: ')}</span>
                  ${info.joinedMembers.map(
                    (appletAgent) => html`
                      <agent-avatar
                        style="margin-left: 5px;"
                        .size=${24}
                        .agentPubKey=${appletAgent.group_pubkey}
                      ></agent-avatar>
                    `,
                  )}
                </div>`
              : ''}
          </div>
        </div>

        <div class="row" style="gap: 12px; justify-content: flex-end; margin-top: 10px;">
          <button
            class="moss-button-secondary"
            style="padding: 10px 20px; font-size: 16px;"
            ?disabled=${this._activatingExisting}
            @click=${() => this.proceedWithNewInstall()}
          >
            ${msg('Create New')}
          </button>
          <button
            class="moss-button"
            style="padding: 10px 20px; font-size: 16px;"
            ?disabled=${this._activatingExisting}
            @click=${() => this.activateExistingTool()}
          >
            ${this._activatingExisting
              ? html`<sl-spinner style="font-size: 16px;"></sl-spinner>`
              : msg('Activate Existing')}
          </button>
        </div>
      </div>
    `;
  }

  renderForm() {
    if (!this._tool) return html`Error.`;

    switch (this._registeredApplets.value.status) {
      case 'pending':
        return html`<div class="row center-content">
          <sl-spinner></sl-spinner>
        </div>`;
      case 'complete':
        const allAppletsNames = Array.from(this._registeredApplets.value.value.values()).map(
          (applet) => (applet as Applet)?.custom_name,
        );
        return html`
          <div class="column install-form">
            <sl-input
              name="custom_name"
              class="moss-input"
              id="custom-name-field"
              .label=${msg('Custom Name')}
              style="margin-bottom: 16px"
              required
              ${ref((input) => {
          if (!input) return;
          setTimeout(() => {
            if (
              this._tool &&
              allAppletsNames.includes(this._tool.toolInfoAndVersions.title)
            ) {
              (input as HTMLInputElement).setCustomValidity('Name already exists');
            } else {
              (input as HTMLInputElement).setCustomValidity('');
            }
          });
        })}
              @input=${(e) => {
            if (allAppletsNames.includes(e.target.value)) {
              e.target.setCustomValidity('Name already exists');
            } else if (e.target.value === '') {
              e.target.setCustomValidity('You need to choose a name for the Tool instance.');
            } else {
              e.target.setCustomValidity('');
            }
          }}
              .defaultValue=${this._tool.toolInfoAndVersions.title}
            ></sl-input>

            <span
              style="text-decoration: underline; cursor: pointer; margin-bottom: 10px;"
              @click=${() => {
            this._showAdvanced = !this._showAdvanced;
          }}
              >${this._showAdvanced ? 'Hide' : 'Show'} Advanced
            </span>

            ${this._showAdvanced
            ? html`
                  <sl-input
                    name="network_seed"
                    id="network-seed-field"
                    .label=${msg('Custom Network Seed')}
                    style="margin-bottom: 16px"
                  ></sl-input>
                `
            : html``}

            <div
              style="margin:0 20px 20px -120px; width: 673px; height:1px; flex-shrink: 0;background-color: var(--moss-grey-light)"
            >
              &nbsp;
            </div>
            <button class="moss-button ${this._installing ? 'loading' : ''}" type="submit">
              ${msg('Add to Group')}
            </button>
            <div>${this._installationProgress}</div>
          </div>
        `;

      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the registered Tools in this group')}
          .error=${this._registeredApplets.value.error}
        ></display-error>`;
    }
  }

  renderGroup() {
    switch (this.groupProfile.value.status) {
      case 'pending':
        return html`loading...`;
      case 'error':
        console.error('Error fetching the profile: ', this.groupProfile.value.error);
        return html`Error fetching the profile.`;
      case 'complete':
        const groupProfile = this.groupProfile.value.value;
        return html`
          &nbsp;<img
            .src=${groupProfile?.icon_src}
            alt="${groupProfile?.name}"
            style="height: 28px; width: 28px"
          />&nbsp;${groupProfile?.name}
        `;
    }
  }

  render() {
    return html`
      <moss-dialog
        id="applet-dialog"
        width="674px"
        @sl-request-close=${(e) => {
        if (this._installing || this._activatingExisting) {
          e.preventDefault();
        } else {
          this.dispatchEvent(
            new CustomEvent('install-tool-dialog-closed', {
              composed: true,
              bubbles: true,
            }),
          );
        }
      }}
      >

      <div slot="header">
        <span style="display:flex;align-items:center;"
          >${msg('Installing to:')} ${this.renderGroup()}</span
        >

        ${this._showDuplicateWarning
          ? html`<span>${msg('Tool already exists')}</span>`
          : html`
            <span>${msg('Heads-up!')}</span>
            <span>${msg('Give this app a custom name.')}</span>
          `}
      </div>

        <div slot="content">
          ${this._showDuplicateWarning
            ? this.renderDuplicateWarning()
            : html`
              <div class="form-text" style="margin-top: -20px; margin-bottom: 30px;">
                <span style="text-decoration: underline; font-weight: bold;">${msg('Note: ')}</span
                >${msg('Adding a new Tool to a group ')}<b>${msg(
                  'creates a new unique instance ',
                )}</b>${msg(
                  "of that Tool which other group members may join directly from the group's main page.",
                )}
                <sl-tooltip
                  content=${msg(
                    `Each time you add a Tool to a group via the Tool Library, you create a new unique peer-to-peer network specifically for that instance of the Tool. Other group members can only join the same network, if they join it from the group main page where it will show up for them in the "Joinable Tools" section. If two members each add the same Tool from the Tool Library, they create two independent peer-to-peer networks. In that way a group can have many independent instances of the same Tool.`,
                  )}
                >
                  <span style="margin-left: 3px; text-decoration: underline; color: blue; cursor: help;"
                    >${msg('Details')}</span
                  ></sl-tooltip
                >
              </div>
              <form class="column" ${onSubmit((f) => this.installApplet(f))}>${this.renderForm()}</form>
            `}
        <div>
        </moss-dialog>
    `;
  }

  static styles = [
    mossStyles,
    toolSettingsStyles,
    css`
      .online-dot {
        border-radius: 50%;
        width: 10px;
        height: 10px;
        margin-right: 10px;
      }

      .online {
        background-color: #17d310;
      }

      .offline {
        background-color: #bfbfbf;
      }

      .loading {
        display: none;
      }

      .form-text {
        color: rgba(0, 0, 0, 0.6);

        font-size: 16px;
        font-style: normal;
        font-weight: 400;
        line-height: 24px; /* 150% */
      }
      .install-form {
        margin-bottom: 10px;
      }

    `,
  ];
}
