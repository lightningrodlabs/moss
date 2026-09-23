import { BrowserWindow } from 'electron';
import { is } from '@electron-toolkit/utils';
import path from 'path';
import type { AudioSourceRow } from '@theweave/moss-types';

type PickerState = {
  window: BrowserWindow;
  rows: AudioSourceRow[];
  resolve: (ids: string[] | null) => void;
};

let PICKER: PickerState | null = null;

/** Rows for the open picker page (empty when none is open). */
export function pickerRows(): AudioSourceRow[] {
  return PICKER?.rows ?? [];
}

/** The picker page confirmed (`ids`) or cancelled (`null`). */
export function pickerSelected(ids: string[] | null): void {
  if (!PICKER) return;
  const picker = PICKER;
  PICKER = null;
  picker.resolve(ids);
  picker.window.close();
}

/**
 * Opens the audio-source picker and resolves the chosen row ids, or null when
 * the user cancels or closes the window. Callers serialise: `AudioSourceGrants`
 * holds the one-picker-at-a-time authority (`pickerOpen` in its `request`), so
 * this function assumes no picker is open and would orphan an earlier one's
 * promise if called while one is.
 */
export function openAudioSourcePicker(rows: AudioSourceRow[]): Promise<string[] | null> {
  const window = new BrowserWindow({
    height: 620,
    width: 520,
    minimizable: false,
    autoHideMenuBar: true,
    title: 'Share audio from',
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/selectaudiosources.js'),
      safeDialogs: true,
    },
  });
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/selectaudiosources.html`);
  } else {
    window.loadFile(path.join(__dirname, '../renderer/selectaudiosources.html'));
  }
  return new Promise((resolve) => {
    PICKER = { window, rows, resolve };
    window.on('closed', () => {
      if (PICKER && PICKER.window === window) {
        PICKER = null;
        resolve(null);
      }
    });
  });
}
