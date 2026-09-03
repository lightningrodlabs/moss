import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized, msg, str } from '@lit/localize';
import { AsyncStatus, StoreSubscriber, derived, readable } from '@holochain-open-dev/stores';
import { EntryRecord } from '@holochain-open-dev/utils';
import { Profile } from '@holochain-open-dev/profiles';
import {
  AgentPubKeyB64,
  EntryHash,
  decodeHashFromBase64,
  encodeHashToBase64,
} from '@holochain/client';
import { AppletInstallProgress } from '@theweave/moss-types';

import '@shoelace-style/shoelace/dist/components/progress-bar/progress-bar.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import { mossStoreContext } from '../../context';
import { MossStore } from '../../moss-store';
import { GroupStore } from '../group-store';

const NO_PROFILE = readable<AsyncStatus<EntryRecord<Profile> | undefined>>({
  status: 'complete',
  value: undefined,
});

/**
 * Shows what an in-flight Tool install is doing right now: which source is
 * being tried, which member is serving, and how far the transfer has come.
 * Renders nothing when no install is in progress for the applet.
 */
@localized()
@customElement('applet-install-progress')
export class AppletInstallProgressElement extends LitElement {
  @consume({ context: mossStoreContext })
  mossStore!: MossStore;

  @property()
  appletHash!: EntryHash;

  @property()
  groupStore: GroupStore | undefined;

  private progress = new StoreSubscriber(
    this,
    () =>
      derived(this.mossStore.appletInstallProgress, (all) =>
        this.appletHash ? all[encodeHashToBase64(this.appletHash)] : undefined,
      ),
    () => [this.appletHash, this.mossStore],
  );

  private peerProfile = new StoreSubscriber(
    this,
    () => {
      const peer = this.currentPeer();
      if (!peer || !this.groupStore) return NO_PROFILE;
      return this.groupStore.profilesStore.profiles.get(decodeHashFromBase64(peer)) ?? NO_PROFILE;
    },
    () => [this.currentPeer(), this.groupStore],
  );

  private currentPeer(): AgentPubKeyB64 | undefined {
    const p = this.progress.value;
    return p && 'peer' in p ? p.peer : undefined;
  }

  private peerName(): string {
    const profile = this.peerProfile.value;
    if (profile && profile.status === 'complete' && profile.value) {
      return profile.value.entry.nickname;
    }
    const peer = this.currentPeer();
    return peer ? `${peer.slice(0, 8)}…` : '';
  }

  private line(p: AppletInstallProgress): string {
    const name = this.peerName();
    switch (p.phase) {
      case 'library':
        return msg('Downloading from the tool library…');
      case 'library-failed':
        return msg('Tool library unreachable. Looking for group members who have this Tool…');
      case 'peer-search':
        return msg('Looking for group members who have this Tool…');
      case 'peer-none':
        return msg('No online group member has this Tool.');
      case 'peer-request':
        return msg(str`Requesting Tool from ${name}…`);
      case 'peer-download':
        return msg(str`Receiving from ${name}…`);
      case 'peer-failed':
        return msg(str`Transfer from ${name} failed. Trying the next member…`);
      case 'installing':
        return msg('Installing…');
      case 'done':
        return msg('Tool installed.');
      case 'failed':
        return msg('Installation failed.');
    }
  }

  render() {
    const p = this.progress.value;
    if (!p) return nothing;
    const settled = p.phase === 'done' || p.phase === 'failed' || p.phase === 'peer-none';
    const isError = p.phase === 'failed' || p.phase === 'peer-none';
    return html`
      <div class="row ${isError ? 'error' : ''}">
        ${settled ? nothing : html`<sl-spinner></sl-spinner>`}
        <span>${this.line(p)}</span>
      </div>
      ${p.phase === 'peer-download'
        ? html`
            <sl-progress-bar value=${Math.round((100 * p.chunksDone) / Math.max(1, p.chunksTotal))}>
              ${p.chunksDone} / ${p.chunksTotal}
            </sl-progress-bar>
          `
        : nothing}
    `;
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 14px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .error {
      color: var(--sl-color-danger-600);
    }
    sl-progress-bar {
      --height: 12px;
      font-size: 11px;
    }
  `;
}
