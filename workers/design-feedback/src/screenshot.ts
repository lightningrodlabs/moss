import { FEEDBACK_LIMITS } from '../../../shared/utils/src/feedback/index.ts';

// Same pattern the shared request validator applies to the screenshot field.
const SCREENSHOT_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const SCREENSHOT_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Decodes a PNG data URL, checking the label, the real PNG signature and the size limit. */
export function decodePngDataUrl(
  dataUrl: string,
): Uint8Array | 'screenshot_invalid' | 'screenshot_too_large' {
  if (!SCREENSHOT_PATTERN.test(dataUrl)) return 'screenshot_invalid';
  let binary: string;
  try {
    binary = atob(dataUrl.slice(SCREENSHOT_PREFIX.length));
  } catch {
    return 'screenshot_invalid';
  }
  if (binary.length < PNG_SIGNATURE.length) return 'screenshot_invalid';
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (binary.charCodeAt(i) !== PNG_SIGNATURE[i]) return 'screenshot_invalid';
  }
  if (binary.length > FEEDBACK_LIMITS.maxScreenshotBytes) return 'screenshot_too_large';
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Stores validated PNG bytes under an unguessable-enough key and returns the public URL.
 * `nowMs` is a clock in milliseconds (default `Date.now`).
 */
export async function storeScreenshot(
  bucket: R2Bucket,
  publicUrl: string,
  bytes: Uint8Array,
  nowMs: () => number = () => Date.now(),
): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  const key = `feedback/${nowMs()}-${suffix}.png`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/png' } });
  return `${publicUrl.replace(/\/+$/, '')}/${key}`;
}
