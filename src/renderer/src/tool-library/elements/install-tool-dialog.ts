import { css, html, LitElement, TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { ActionHash, encodeHashToBase64, HoloHashMap, YamlProperties } from '@holochain/client';
import { localized, msg } from '@lit/localize';
import { ref } from 'lit/directives/ref.js';
import {
  completed,
  joinAsyncMap,
  pipe,
  StoreSubscriber,
  toPromise,
} from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { notify, notifyError, onSubmit } from '@holochain-open-dev/elements';
import { GetonlyMap, slice } from '@holochain-open-dev/utils';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import SlTextarea from '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

import { groupStoreContext } from '../../groups/context.js';
import { mossStyles } from '../../shared-styles.js';
import { GroupStore } from '../../groups/group-store.js';
import { amIPrivileged, myStewardPermissionHash } from '../../groups/accountability-utils.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { ToolAndCurationInfo } from '../../types.js';
import { MossDialog } from '../../ui/moss-dialog.js';
import '../../ui/moss-dialog.js';
import { Applet, AppletAgent } from '@theweave/group-client';
import { toolCompatibilityIdFromDistInfoString } from '@theweave/utils';
import {
  DistributionInfo,
  RoleProperties,
  TDistributionInfo,
  ToolInfoAndVersions,
  TToolWeaveConfig,
} from '@theweave/moss-types';
import { ToolInstallOption } from '@theweave/api';
import { Value } from '@sinclair/typebox/value';
import { toolSettingsStyles } from '../../groups/elements/settings/tool-settings-styles.js';
import { fetchAndValidateHappOrWebhapp } from '../../electron-api';
import yaml from 'js-yaml';
import { checkDeclarations, mergeProperties } from '../install-options.js';
import { declarationProblemMessage } from '../install-options-messages.js';
import { InstallOptionsForm } from './install-options-form.js';
import './install-options-form.js';
import { MatchingInactiveTool } from './install-tool-duplicate-warning.js';
import './install-tool-duplicate-warning.js';

/** What the install dialog learns from downloading the Tool before it renders the form. */
type ToolInspection = {
  roles: RoleProperties;
  options?: ToolInstallOption[];
  problem?: string;
};

const DEV_CONFIG_MARKER = '###DEVCONFIG###';

@localized()
@customElement('install-tool-dialog')
export class InstallToolDialog extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  _registeredApplets = new StoreSubscriber(
    this,
    () =>
      this.groupStore
        ? pipe(this.groupStore.allAdvertisedApplets, (allAppletsHashes) =>
            joinAsyncMap(slice(this.groupStore.applets as GetonlyMap<any, any>, allAppletsHashes)),
          )
        : completed(new HoloHashMap()),
    () => [this.groupStore],
  );

  @query('#applet-dialog')
  _appletDialog!: MossDialog;

  @query('form')
  form!: HTMLFormElement;

  @state()
  _installing: boolean = false;

  @state()
  _installationProgress: string | undefined;

  @state()
  _tool: ToolAndCurationInfo | undefined;

  @state()
  _dnaProperties: RoleProperties = {};

  @state()
  _installOptions: ToolInstallOption[] | undefined;

  @state()
  _optionsProblem: string | undefined;

  @query('install-options-form')
  _optionsForm!: InstallOptionsForm | null;

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
    () => this.groupStore?.groupProfile,
    () => [this.groupStore],
  );
  async open(tool: ToolAndCurationInfo) {
    // reload all advertised applets
    await this.groupStore.allAdvertisedApplets.reload();
    this._tool = tool;
    this._dnaProperties = {};
    this._installOptions = undefined;
    this._optionsProblem = undefined;
    this._showAdvanced = false;
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

    this.downloadWebHapp().then((inspection) => {
      this._dnaProperties = inspection.roles;
      this._installOptions = inspection.options;
      this._optionsProblem = inspection.problem;
    });

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
    this._dnaProperties = {};
    this._showAdvanced = false;
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

  async checkPrivileges(): Promise<[boolean, ActionHash | undefined]> {
    const myAccountabilities = await toPromise(this.groupStore.myAccountabilities);
    return [amIPrivileged(myAccountabilities), myStewardPermissionHash(myAccountabilities)];
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
      notifyError(msg('Failed to activate tool (See console for details).'));
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

  async installApplet(fields: {
    custom_name: string;
    network_seed?: string;
    properties?: Record<string, YamlProperties>;
  }) {
    if (this._installing) return;
    if (!this._tool) {
      notifyError(msg('Tool undefined.'));
      throw new Error('Tool undefined.');
    }

    this._installing = true;
    try {
      // Trigger the download of the icon
      // TODO convert icon to base64 and store it on disk
      this._installationProgress = msg('Checking permission type...');
      const [isPriv, permission_hash] = await this.checkPrivileges();
      if (!isPriv) {
        console.error('No valid permission to add a Tool to this group.');
        notifyError(msg('No valid permission to add a Tool to this group.'));
        this._appletDialog.hide();
        this._installing = false;
        this._installationProgress = undefined;
        return;
      }
      this._installationProgress = msg('Downloading and installing Tool...');
      const appletEntryHash = await this.groupStore.installAndAdvertiseApplet(
        this._tool,
        fields.custom_name,
        fields.network_seed ? fields.network_seed : undefined,
        permission_hash,
        fields.properties ? fields.properties : undefined,
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
      notifyError(msg('Installation failed! (See console for details)'));
      console.error(`Installation error: ${e}`);
      this._installing = false;
    }
  }

  /**
   * The YAML editor is the base when it was shown, else the manifest
   * defaults; the option form's values overlay it per role. Roles no option
   * writes and no editor showed are left out so the conductor keeps the
   * manifest defaults for them.
   */
  propertiesToInstall(fields: Record<string, unknown>): RoleProperties {
    const base: RoleProperties = {};
    Object.entries(fields).forEach(([key, value]) => {
      if (key.startsWith('role-')) {
        base[key.substring(5)] = (yaml.load(value as string) ?? {}) as Record<string, unknown>;
      }
    });
    if (!this._installOptions || !this._optionsForm) return base;
    for (const option of this._installOptions) {
      if (!(option.role in base))
        base[option.role] = { ...(this._dnaProperties[option.role] ?? {}) };
    }
    return mergeProperties(base, this._installOptions, this._optionsForm.currentValues);
  }

  async downloadWebHapp(): Promise<ToolInspection> {
    if (!this._tool) return Promise.reject('No tool defined.');
    const url = this._tool.latestVersion.url;
    // Dev-config Tools carry their UI dev server port after the marker.
    const portString = this._tool.toolListUrl.startsWith(DEV_CONFIG_MARKER)
      ? this._tool.toolListUrl.slice(DEV_CONFIG_MARKER.length)
      : '';
    const uiPort = portString ? parseInt(portString) : undefined;
    const res = await fetchAndValidateHappOrWebhapp(url, uiPort);
    const roles = res.type === 'webhapp' ? res.happ.roles : res.roles;
    if (res.weaveConfig === undefined) return { roles };
    if (!Value.Check(TToolWeaveConfig, res.weaveConfig)) {
      return {
        roles,
        problem: msg('This Tool declares install options in a format Moss does not understand.'),
      };
    }
    const options = res.weaveConfig.installOptions ?? [];
    const declarationProblem = checkDeclarations(options, Object.keys(roles));
    if (declarationProblem) {
      return { roles, problem: declarationProblemMessage(declarationProblem) };
    }
    return { roles, options };
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
        /** Generate UI for dna properties per role */
        //console.log("dnaProperties", this._dnaProperties);
        const dnaParams: TemplateResult<1>[] = [];
        for (const [roleName, properties] of Object.entries(this._dnaProperties)) {
          const yamlStr = yaml.dump(properties);
          //const yamlStr = JSON.stringify(properties, null, 2);
          dnaParams.push(html`
            <sl-tab slot="nav" .panel=${roleName}>${roleName}</sl-tab>
            <sl-tab-panel .name=${roleName}>
              <sl-textarea
                filled
                resize="auto"
                name="role-${roleName}"
                id="properties-field-${roleName}"
                help-text=${this._installOptions?.length
                  ? msg('yaml. Values chosen above override these keys.')
                  : 'yaml'}
                size="small"
                .placeholder=${yamlStr}
                rows="6"
                .value=${yamlStr}
                style="font-family: monospace"
                @sl-input=${(e) => {
                  const value = e.target.value;
                  const elem = this.shadowRoot!.getElementById(
                    `properties-field-${roleName}`,
                  ) as unknown as SlTextarea;
                  try {
                    const parsed = yaml.load(value);
                    if (parsed !== null && typeof parsed !== 'object') {
                      throw Error(msg('Invalid yaml'));
                    }
                  } catch (e: any) {
                    console.error('Failed to parse YAML:', value);
                    elem.setCustomValidity(e.message);
                    return;
                  }
                  elem.setCustomValidity('');
                }}
              ></sl-textarea>
            </sl-tab-panel>
          `);
        }
        /** */
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
                  if (this._tool && allAppletsNames.includes((input as any).value)) {
                    (input as HTMLInputElement).setCustomValidity(msg('Name already exists'));
                  } else {
                    (input as HTMLInputElement).setCustomValidity('');
                  }
                });
              })}
              @input=${(e) => {
                if (allAppletsNames.includes(e.target.value)) {
                  e.target.setCustomValidity(msg('Name already exists'));
                } else if (e.target.value === '') {
                  e.target.setCustomValidity(
                    msg('You need to choose a name for the Tool instance.'),
                  );
                } else {
                  e.target.setCustomValidity('');
                }
              }}
              .defaultValue=${this._tool.toolInfoAndVersions.title}
            ></sl-input>

            ${this._optionsProblem
              ? html`<sl-alert variant="warning" open style="margin-bottom: 16px;">
                  ${this._optionsProblem} ${msg('You can still set DNA properties under Advanced.')}
                </sl-alert>`
              : html``}
            ${this._installOptions && this._installOptions.length > 0
              ? html`
                  <div style="font-weight: 600; margin-bottom: 8px;">${msg('Install options')}</div>
                  <install-options-form
                    .options=${this._installOptions}
                    .manifestDefaults=${this._dnaProperties}
                  ></install-options-form>
                `
              : html``}

            <span
              style="text-decoration: underline; cursor: pointer; margin-bottom: 10px;"
              @click=${() => (this._showAdvanced = !this._showAdvanced)}
            >
              ${this._showAdvanced ? msg('Hide') : msg('Show')} ${msg('Advanced')}
            </span>

            ${this._showAdvanced
              ? html`
                  <sl-input
                    name="network_seed"
                    id="network-seed-field"
                    .label=${msg('Custom Network Seed')}
                    style="margin-bottom: 16px"
                  ></sl-input>
                  ${dnaParams.length > 0
                    ? html`
                        <div>${msg('Custom DNA properties (per Role)')}</div>
                        <sl-tab-group> ${dnaParams} </sl-tab-group>
                      `
                    : html``}
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
    if (!this.groupProfile.value) return html``;
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

        ${
          this._showDuplicateWarning
            ? html`<span>${msg('Tool already exists')}</span>`
            : html`
                <span>${msg('Heads-up!')}</span>
                <span>${msg('Give this app a custom name.')}</span>
              `
        }
      </div>

        <div slot="content">
          ${
            this._showDuplicateWarning
              ? html`<install-tool-duplicate-warning
                  .info=${this._matchingInactiveTool}
                  .activating=${this._activatingExisting}
                  @create-new=${() => this.proceedWithNewInstall()}
                  @activate-existing=${() => this.activateExistingTool()}
                ></install-tool-duplicate-warning>`
              : html`
                  <div class="form-text" style="margin-top: -20px; margin-bottom: 30px;">
                    <span style="text-decoration: underline; font-weight: bold;"
                      >${msg('Note: ')}</span
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
                      <span
                        style="margin-left: 3px; text-decoration: underline; color: blue; cursor: help;"
                        >${msg('Details')}</span
                      ></sl-tooltip
                    >
                  </div>
                  <form
                    class="column"
                    ${onSubmit((f) => {
                      if (this._optionsForm && !this._optionsForm.reportValidity()) return;
                      this.installApplet({
                        custom_name: f.custom_name,
                        network_seed: f.network_seed,
                        properties: this.propertiesToInstall(f),
                      });
                    })}
                  >
                    ${this.renderForm()}
                  </form>
                `
          }
        <div>
        </moss-dialog>
    `;
  }

  static styles = [
    mossStyles,
    toolSettingsStyles,
    css`
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
