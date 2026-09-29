/**
 * The user's LAN discovery choice (Settings > Services > Local Discovery).
 *
 * It lives in the profile's config directory rather than in the renderer's
 * storage because the main process needs it before the conductor starts: it
 * decides what goes into conductor-config.yaml. It has a file of its own so
 * that resetting the network overrides leaves it alone.
 */
import fs from 'fs';
import path from 'path';

const FILE_NAME = 'lan-discovery.json';

type StoredSetting = { enabled: boolean };

/**
 * The saved choice, or `undefined` if none was ever saved. A file that cannot
 * be read or parsed also reads as `undefined`, so a damaged file falls back to
 * the default instead of failing startup.
 */
export function readLanDiscoverySetting(configDir: string): boolean | undefined {
  const file = path.join(configDir, FILE_NAME);
  try {
    if (!fs.existsSync(file)) return undefined;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<StoredSetting>;
    return typeof parsed.enabled === 'boolean' ? parsed.enabled : undefined;
  } catch (e) {
    console.warn('Failed to read the LAN discovery setting:', e);
    return undefined;
  }
}

export function writeLanDiscoverySetting(configDir: string, enabled: boolean): void {
  fs.mkdirSync(configDir, { recursive: true });
  const setting: StoredSetting = { enabled };
  fs.writeFileSync(path.join(configDir, FILE_NAME), JSON.stringify(setting, null, 2), 'utf-8');
}
