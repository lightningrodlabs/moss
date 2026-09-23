import { writable, Writable } from '@holochain-open-dev/stores';
import type { AudioSourceGrantInfo } from '@theweave/moss-types';
import { listAudioSourceGrants, onAudioSourceGrantsChanged } from '../electron-api.js';

/**
 * Renderer mirror of the main process's grant list. Main is the authority;
 * this store only re-renders the chip and the settings list when main says the
 * list changed.
 */
export const audioSourceGrants: Writable<AudioSourceGrantInfo[]> = writable([]);

let initialised = false;
export async function initAudioSourceGrantsStore(): Promise<void> {
  if (initialised) return;
  initialised = true;
  onAudioSourceGrantsChanged((grants) => audioSourceGrants.set(grants));
  audioSourceGrants.set(await listAudioSourceGrants());
}
