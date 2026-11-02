import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { decode } from '@msgpack/msgpack';
import AdmZip from 'adm-zip';

// Deliberately free of electron imports so this runs under plain vitest.
const gunzipAsync = promisify(gunzip);

type WebhappBundle = { resources?: Record<string, Uint8Array> };

/**
 * Reads the Tool's `weave.config.json` out of the UI zip bundled in a
 * `.webhapp`. Returns the parsed JSON, unchecked, or `undefined` when the
 * bundle has no UI zip, the zip has no such file, or the file is not JSON.
 */
export async function readWeaveConfigFromWebhapp(
  webhappBytes: Uint8Array,
): Promise<unknown | undefined> {
  try {
    const bundle = decode(await gunzipAsync(webhappBytes)) as WebhappBundle;
    const uiEntry = Object.entries(bundle.resources ?? {}).find(([name]) => name.endsWith('.zip'));
    if (!uiEntry) return undefined;
    const zip = new AdmZip(Buffer.from(uiEntry[1]));
    const file = zip.getEntry('weave.config.json');
    if (!file) return undefined;
    return JSON.parse(file.getData().toString('utf-8'));
  } catch (e) {
    console.warn('Could not read weave.config.json from webhapp:', e);
    return undefined;
  }
}
