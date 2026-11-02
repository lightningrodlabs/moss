import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { encode } from '@msgpack/msgpack';
import AdmZip from 'adm-zip';
import { readWeaveConfigFromWebhapp } from './webhappWeaveConfig';

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
