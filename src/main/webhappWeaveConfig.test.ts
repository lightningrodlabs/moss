import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { encode } from '@msgpack/msgpack';
import AdmZip from 'adm-zip';
import {
  happFromBundle,
  readWebhappBundle,
  readWeaveConfigFromWebhapp,
  weaveConfigFromBundle,
} from './webhappWeaveConfig';

function uiZip(files: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content, 'utf-8'));
  }
  return zip.toBuffer();
}

function webhapp(ui: Buffer): Uint8Array {
  const bundle = {
    manifest: { manifest_version: '0', name: 'test', ui: { bundled: 'ui.zip' } },
    resources: { 'ui.zip': ui, 'test.happ': new Uint8Array([1, 2, 3]) },
  };
  return new Uint8Array(gzipSync(Buffer.from(encode(bundle))));
}

describe('readWeaveConfigFromWebhapp', () => {
  it('returns the parsed weave.config.json from the UI zip', async () => {
    const bytes = webhapp(
      uiZip({ 'index.html': '<html>', 'weave.config.json': '{"installOptions":[]}' }),
    );
    await expect(readWeaveConfigFromWebhapp(bytes)).resolves.toEqual({ installOptions: [] });
  });

  it('returns undefined when the UI has no weave.config.json', async () => {
    const bytes = webhapp(uiZip({ 'index.html': '<html>' }));
    await expect(readWeaveConfigFromWebhapp(bytes)).resolves.toBeUndefined();
  });

  it('returns undefined when weave.config.json is not JSON', async () => {
    const bytes = webhapp(uiZip({ 'weave.config.json': 'not json' }));
    await expect(readWeaveConfigFromWebhapp(bytes)).resolves.toBeUndefined();
  });
});

function gz(bundle: unknown): Uint8Array {
  return new Uint8Array(gzipSync(Buffer.from(encode(bundle))));
}

describe('readWebhappBundle', () => {
  it('decodes the bundle once for both the happ and the config', async () => {
    const ui = uiZip({ 'weave.config.json': '{"crossGroupView":true}' });
    const bundle = await readWebhappBundle(webhapp(ui));
    expect(weaveConfigFromBundle(bundle)).toEqual({ crossGroupView: true });
    expect([...happFromBundle(bundle)!]).toEqual([1, 2, 3]);
  });
});

describe('weaveConfigFromBundle', () => {
  const real = uiZip({ 'weave.config.json': '{"which":"real"}' });
  const decoy = uiZip({ 'weave.config.json': '{"which":"decoy"}' });

  it('uses the zip the manifest names as bundled, not the first zip listed', async () => {
    const bundle = await readWebhappBundle(
      gz({
        manifest: { ui: { bundled: 'real.zip' } },
        resources: { 'decoy.zip': decoy, 'real.zip': real },
      }),
    );
    expect(weaveConfigFromBundle(bundle)).toEqual({ which: 'real' });
  });

  it('accepts the manifest naming the zip by path, as hc web-app pack writes it', async () => {
    const bundle = await readWebhappBundle(
      gz({
        manifest: { ui: { path: 'real.zip' } },
        resources: { 'decoy.zip': decoy, 'real.zip': real },
      }),
    );
    expect(weaveConfigFromBundle(bundle)).toEqual({ which: 'real' });
  });

  it('falls back to the only zip when the manifest names none', async () => {
    const bundle = await readWebhappBundle(
      gz({ manifest: {}, resources: { 'ui.zip': real, 'x.happ': new Uint8Array([9]) } }),
    );
    expect(weaveConfigFromBundle(bundle)).toEqual({ which: 'real' });
  });
});

describe('happFromBundle', () => {
  it('uses the happ the manifest names', async () => {
    const bundle = await readWebhappBundle(
      gz({
        manifest: { happ: { path: 'b.happ' } },
        resources: { 'a.happ': new Uint8Array([1]), 'b.happ': new Uint8Array([2]) },
      }),
    );
    expect([...happFromBundle(bundle)!]).toEqual([2]);
  });

  it('is undefined when there is no happ', async () => {
    const bundle = await readWebhappBundle(gz({ manifest: {}, resources: {} }));
    expect(happFromBundle(bundle)).toBeUndefined();
  });
});
