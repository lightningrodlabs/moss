import fs from 'fs';
import path from 'path';

/** Desktop entry ids of every packaged Moss version start with this. */
const MOSS_DESKTOP_ID_PREFIX = 'org.lightningrodlabs.moss';

const isMossDesktopId = (id: string): boolean =>
  id.startsWith(MOSS_DESKTOP_ID_PREFIX) && id.endsWith('.desktop');

/**
 * Returns the mimeapps.list content with Moss removed from every `text/html` handler
 * line, or null when Moss is not named on any of them. Handler lines carry either a single
 * desktop id or a `;`-separated list; a list keeps its trailing separator.
 */
export function withoutMossHtmlHandler(content: string): string | null {
  let changed = false;
  const lines = content.split('\n').flatMap((line) => {
    const match = line.match(/^text\/html=(.*)$/);
    if (!match) return [line];
    const isList = match[1].includes(';');
    const ids = match[1].split(';').filter((id) => id.length > 0);
    const kept = ids.filter((id) => !isMossDesktopId(id));
    if (kept.length === ids.length) return [line];
    changed = true;
    if (kept.length === 0) return [];
    return [`text/html=${kept.join(';')}${isList ? ';' : ''}`];
  });
  return changed ? lines.join('\n') : null;
}

/** Every file xdg-mime writes user defaults to, oldest location last. */
const mimeappsFiles = (env: NodeJS.ProcessEnv, homeDir: string): string[] => [
  path.join(env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'mimeapps.list'),
  path.join(
    env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'),
    'applications',
    'mimeapps.list',
  ),
];

/**
 * Moss never handles HTML, so any text/html association naming it is one that an earlier
 * build left behind by registering its deep link scheme through xdg-settings. Removing it
 * hands HTML files back to whatever the desktop environment falls back to.
 */
export function repairLinuxHtmlDefault(env: NodeJS.ProcessEnv, homeDir: string): void {
  for (const file of mimeappsFiles(env, homeDir)) {
    try {
      if (!fs.existsSync(file)) continue;
      const repaired = withoutMossHtmlHandler(fs.readFileSync(file, 'utf-8'));
      if (repaired === null) continue;
      fs.writeFileSync(file, repaired, 'utf-8');
      console.log(`Removed Moss as text/html handler from ${file}`);
    } catch (e) {
      console.warn(`Failed to repair text/html handler in ${file}: `, e);
    }
  }
}
