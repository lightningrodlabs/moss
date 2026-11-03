import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { decode } from '@msgpack/msgpack';
import AdmZip from 'adm-zip';

// Deliberately free of electron imports so this runs under plain vitest.
const gunzipAsync = promisify(gunzip);

type BundledResource = { bundled?: string; path?: string };

/**
 * A decoded `.webhapp`: its manifest names the UI zip and the happ among the
 * resources. `hc web-app pack` writes those names under `path`; older
 * bundles use `bundled`.
 */
export type WebhappBundle = {
  manifest?: { ui?: BundledResource; happ?: BundledResource };
  resources?: Record<string, Uint8Array>;
};

export async function readWebhappBundle(webhappBytes: Uint8Array): Promise<WebhappBundle> {
  return decode(await gunzipAsync(webhappBytes)) as WebhappBundle;
}

function resource(
  bundle: WebhappBundle,
  named: BundledResource | undefined,
  suffix: string,
): Uint8Array | undefined {
  const resources = bundle.resources ?? {};
  const name = named?.bundled ?? named?.path;
  if (name !== undefined && resources[name] !== undefined) return resources[name];
  return Object.entries(resources).find(([key]) => key.endsWith(suffix))?.[1];
}

/** The happ inside the bundle, or `undefined` when it has none. */
export function happFromBundle(bundle: WebhappBundle): Uint8Array | undefined {
  return resource(bundle, bundle.manifest?.happ, '.happ');
}

/**
 * The Tool's `weave.config.json` from the bundle's UI zip, parsed but
 * unchecked, or `undefined` when there is no UI zip, no such file, or the
 * file is not JSON.
 */
export function weaveConfigFromBundle(bundle: WebhappBundle): unknown | undefined {
  try {
    const ui = resource(bundle, bundle.manifest?.ui, '.zip');
    if (!ui) return undefined;
    const file = new AdmZip(Buffer.from(ui)).getEntry('weave.config.json');
    if (!file) return undefined;
    return JSON.parse(file.getData().toString('utf-8'));
  } catch (e) {
    console.warn('Could not read weave.config.json from webhapp:', e);
    return undefined;
  }
}

export async function readWeaveConfigFromWebhapp(
  webhappBytes: Uint8Array,
): Promise<unknown | undefined> {
  return weaveConfigFromBundle(await readWebhappBundle(webhappBytes));
}
