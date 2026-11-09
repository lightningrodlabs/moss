import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { FEEDBACK_LIMITS } from '../../../shared/utils/src/feedback/index.ts';
import { decodePngDataUrl, storeScreenshot } from '../src/screenshot';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function toDataUrl(bytes: Uint8Array, mime = 'image/png'): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function pngOfLength(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(PNG_SIGNATURE);
  return bytes;
}

describe('decodePngDataUrl', () => {
  it('accepts a payload with a valid PNG header', () => {
    const bytes = pngOfLength(32);
    expect(decodePngDataUrl(toDataUrl(bytes))).toEqual(bytes);
  });

  it('rejects JPEG bytes labelled as PNG', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    expect(decodePngDataUrl(toDataUrl(jpeg))).toBe('screenshot_invalid');
  });

  it('rejects an image/jpeg data url', () => {
    expect(decodePngDataUrl(toDataUrl(pngOfLength(32), 'image/jpeg'))).toBe('screenshot_invalid');
  });

  it('rejects a payload shorter than the signature', () => {
    expect(decodePngDataUrl(toDataUrl(new Uint8Array([0x89, 0x50])))).toBe('screenshot_invalid');
  });

  it('accepts exactly the maximum size', () => {
    const result = decodePngDataUrl(toDataUrl(pngOfLength(FEEDBACK_LIMITS.maxScreenshotBytes)));
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('rejects one byte over the maximum size', () => {
    const dataUrl = toDataUrl(pngOfLength(FEEDBACK_LIMITS.maxScreenshotBytes + 1));
    expect(decodePngDataUrl(dataUrl)).toBe('screenshot_too_large');
  });
});

describe('storeScreenshot', () => {
  it('stores the object and returns its public url', async () => {
    const bytes = pngOfLength(64);
    const url = await storeScreenshot(env.FEEDBACK_BUCKET, 'https://img.example.com/', bytes, () => 1_800_000_000_000);
    expect(url).toMatch(/^https:\/\/img\.example\.com\/feedback\/1800000000000-[a-z0-9]{6}\.png$/);
    const key = url.slice('https://img.example.com/'.length);
    const stored = await env.FEEDBACK_BUCKET.get(key);
    expect(stored).not.toBeNull();
    expect(stored?.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(bytes);
  });
});
