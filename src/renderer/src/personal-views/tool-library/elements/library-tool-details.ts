import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import { ToolAndCurationInfo, UnifiedToolEntry, VersionBranchInfo } from '../../../types';
import { getPrimaryVersionBranch } from '../../../utils';
import { mossStyles } from '../../../shared-styles';
import { DeveloperCollective } from '@theweave/moss-types';
import { libraryStyles } from '../libraryStyles';
import TimeAgo from 'javascript-time-ago';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '../../../elements/_new_design/select-group.js';

enum TabsState {
  Overview,
  Versions,
}

/**
 * @element library-tool-details
 */
@localized()
@customElement('library-tool-details')
export class LibraryToolDetails extends LitElement {
  timeAgo = new TimeAgo('en-US');

  @property()
  tool: ToolAndCurationInfo | undefined; // Keep for backward compatibility

  @property()
  unifiedTool: UnifiedToolEntry | undefined;

  @property()
  devCollectives: Record<string, DeveloperCollective> = {};

  @state()
  tabsState: TabsState = TabsState.Overview;

  renderOverview() {
    const tool = this.unifiedTool || (this.tool ? {
      description: this.tool.toolInfoAndVersions.description,
    } : null);
    return html`
      <div class="tool-description" style="margin-top:25px;">
        ${tool?.description || this.tool?.toolInfoAndVersions.description}
      </div>
    `;
  }

  renderVersion(version, showInstallButton = false, versionBranch?: string, isFirstInList = false, hasMultipleBranches = false) {

    return html`<div class="column" style="margin-top: 10px; padding-left: 0; border-left: none;">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="version" style="padding-left: 0; border-left: none;">
          v${version.version} ${isFirstInList ? ' (latest)' : ''}
        </div>
      </div>
      <div>
        Released:
        <sl-tooltip .content="${`${new Date(version.releasedAt)}`}">
          <span>${this.timeAgo.format(version.releasedAt)}</span></sl-tooltip
        >
      </div>
      <div>Change Log: ${version.changelog}</div>
          ${showInstallButton && hasMultipleBranches ? html`
          <select-group
            .buttonWidth=${'auto'}
            .buttonText=${msg(str`Install v${version.version} to a group space`)}
            @group-selected=${async (e: CustomEvent) => {
          this.dispatchEvent(
            new CustomEvent('install-tool-to-group', {
              detail: {
                unifiedTool: this.unifiedTool,
                versionBranch: versionBranch,
                groupDnaHash: e.detail
              },
              composed: true,
            }),
          );
        }}
          ></select-group>
        ` : ''}
    </div>`;
  }

  renderVersionBranch(branchInfo: VersionBranchInfo, isPrimaryBranch = false, hasMultipleBranches = false, isFirstBranch = false) {

    return html`
      ${!isFirstBranch ? html`<div class="version-branch-divider"></div>` : ''}
      ${branchInfo.allVersions.map((version, index) =>
      this.renderVersion(
        version,
        index === 0 && hasMultipleBranches, // Show install button after first version if there are multiple branches
        branchInfo.versionBranch,
        index === 0 && isPrimaryBranch, // isFirstInList - only mark as latest if it's the primary branch and first version
        hasMultipleBranches
      )
    )}
    `;
  }

  renderVersions() {
    if (this.unifiedTool) {
      // Show version branches grouped by major version
      // Sort by comparing versionBranch strings properly:
      // - Extract numeric parts and compare
      // - Handle formats like "1.x.x", "0.1.x", "0.0.1"
      const branches = Array.from(this.unifiedTool.versionBranches.values())
        .sort((a, b) => {
          // Parse versionBranch strings to compare properly
          const parseVersionBranch = (vb: string): number[] => {
            // Handle formats: "1.x.x", "0.1.x", "0.0.1"
            const parts = vb.split('.');
            const nums: number[] = [];
            for (const part of parts) {
              if (part === 'x') break; // Stop at first 'x'
              const num = parseInt(part, 10);
              if (!isNaN(num)) {
                nums.push(num);
              } else {
                break;
              }
            }
            return nums;
          };

          const partsA = parseVersionBranch(a.versionBranch);
          const partsB = parseVersionBranch(b.versionBranch);

          // Compare parts from left to right
          const maxLen = Math.max(partsA.length, partsB.length);
          for (let i = 0; i < maxLen; i++) {
            const valA = partsA[i] ?? 0;
            const valB = partsB[i] ?? 0;
            if (valB !== valA) {
              return valB - valA; // Descending
            }
          }

          // If all parts are equal, compare strings
          return b.versionBranch.localeCompare(a.versionBranch);
        });

      const primaryBranch = getPrimaryVersionBranch(this.unifiedTool);
      const hasMultipleBranches = branches.length > 1;

      return html`
        <div class="version-list">
          ${branches.map((branch, branchIndex) =>
        this.renderVersionBranch(branch, branch === primaryBranch, hasMultipleBranches, branchIndex === 0)
      )}
        </div>
      `;
    } else if (this.tool) {
      // Fallback to old behavior - no branches, so no install buttons in list
      const versions = this.tool.toolInfoAndVersions.versions;
      return html`
        <div class="version-list">
          ${versions.map((version, index) =>
        this.renderVersion(version, false, undefined, index === 0, false)
      )}
        </div>
      `;
    }
    return html``;
  }

  renderContent() {
    switch (this.tabsState) {
      case TabsState.Overview:
        return this.renderOverview();
      case TabsState.Versions:
        return this.renderVersions();
    }
  }

  render() {
    const tool = this.unifiedTool || this.tool;
    if (!tool) {
      return 'NOTHING';
    }

    const primaryBranch = this.unifiedTool ? getPrimaryVersionBranch(this.unifiedTool) : null;
    const displayTool = this.unifiedTool || {
      icon: this.tool!.toolInfoAndVersions.icon,
      title: this.tool!.toolInfoAndVersions.title,
      subtitle: this.tool!.toolInfoAndVersions.subtitle,
      tags: this.tool!.toolInfoAndVersions.tags,
      latestVersion: this.tool!.latestVersion,
    };

    // Calculate if there are multiple version branches (major versions) for "older versions available" message
    let hasMultipleBranches = false;
    if (this.unifiedTool) {
      hasMultipleBranches = this.unifiedTool.versionBranches.size > 1;
    } else if (this.tool) {
      // For old format, check if there are multiple versions (can't determine branches)
      hasMultipleBranches = false; // Old format doesn't have branch info, so don't show the message
    }

    return html` 
      
      <div class="column" style="margin-top: 10px;">
        <div class="row" style="justify-content: space-between; align-items: center;">
          <div class="row">
            <img
              src=${displayTool.icon}
              alt="${displayTool.title} tool icon"
              style="height: 64px; width: 64px; border-radius: 16px; margin-right: 15px;"
            />
            <div class="column">
              ${displayTool.subtitle}
              ${displayTool.tags.length > 0
        ? html`
                    <div class="row tool-tag-list" style="margin-top:6px">
                      ${displayTool.tags.map(
          (tag) => html`<div class="tool-tag">${tag}</div>`,
        )}
                    </div>
                  `
        : ''}
            </div>
          </div>
          <div class="column" style="align-items: flex-end;">
            ${primaryBranch ? html`
              <select-group
                .buttonWidth=${'auto'}
                .buttonText=${msg(str`Install v${primaryBranch.latestVersion.version} to a group space`)}
                @group-selected=${async (e: CustomEvent) => {
          this.dispatchEvent(
            new CustomEvent('install-tool-to-group', {
              detail: {
                unifiedTool: this.unifiedTool,
                versionBranch: primaryBranch.versionBranch,
                groupDnaHash: e.detail
              },
              composed: true,
            }),
          );
        }}
              ></select-group>
            ` : this.tool ? html`
              <select-group
                .buttonWidth=${'auto'}
                .buttonText=${(() => {
          if (this.tool?.toolInfoAndVersions.versions && this.tool.toolInfoAndVersions.versions.length > 0) {
            const version = this.tool.toolInfoAndVersions.versions[0].version;
            return msg(str`Install v${version} to a group space`);
          }
          return undefined;
        })()}
                @group-selected=${async (e: CustomEvent) => {
          this.dispatchEvent(
            new CustomEvent('install-tool-to-group', {
              detail: { tool: this.tool, groupDnaHash: e.detail },
              composed: true,
            }),
          );
        }}
              ></select-group>
            ` : ''}
            ${hasMultipleBranches ? html`
              <div style="font-size: 12px; color: rgba(0, 0, 0, 0.4); margin-top: -15px; text-align: right;">
                older versions available
              </div>
            ` : ''}
          </div>
        </div>
        <div class="row items-center tab-bar flex-1" style="margin-top:30px">
          <button
            class="tab ${this.tabsState === TabsState.Overview ? 'tab-selected' : ''}"
            @click=${() => {
        this.tabsState = TabsState.Overview;
      }}
          >
            ${msg('Overview')}
          </button>
          <button
            class="tab ${this.tabsState === TabsState.Versions ? 'tab-selected' : ''}"
            @click=${() => {
        this.tabsState = TabsState.Versions;
      }}
          >
            ${msg('Versions')}
          </button>
        </div>
        <div class="column">
          ${this.renderContent()}
        </div>
      </div>
    `;
  }
  static styles = [
    mossStyles,
    libraryStyles,
    css`
      .version-list {
        margin-top: 25px;
      }
      .version-branch-divider {
        height: 1px;
        background-color: rgba(0, 0, 0, 0.1);
        margin: 20px 0;
      }
      .version {
        font-size: 16px;
        font-weight: 600;
      }
    `,
  ];
}
