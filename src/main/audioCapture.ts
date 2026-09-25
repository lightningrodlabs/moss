/* eslint-disable @typescript-eslint/no-var-requires */
import type {
  FlexStream,
  JsAudioChunk,
  JsDeviceInfo,
  JsProcessInfo,
  JsStreamEvent,
  OpenOptions,
} from '@lightningrodlabs/flexaudio';
import type { AudioBackendName, AudioCapabilities } from '@theweave/moss-types';

/**
 * The subset of `@lightningrodlabs/flexaudio` this app consumes. Narrowing the
 * surface keeps the grant engine testable with a hand-written fake.
 */
export interface AudioCaptureBackend {
  devices(): JsDeviceInfo[];
  processes(): Promise<JsProcessInfo[]>;
  openStream(
    options: OpenOptions,
    onChunk: (chunk: JsAudioChunk) => void,
    onEvent?: (event: JsStreamEvent) => void,
  ): FlexStream;
}

const ADDON_ID = '@lightningrodlabs/flexaudio';

/**
 * Loads the native addon lazily. The `.node` binary links `libpipewire-0.3.so.0`
 * at load time, so on a host without PipeWire the require itself throws; that is
 * the `supported: false` signal, not an error to surface.
 */
export function loadAudioCapture(
  requireFn: (id: string) => unknown = require,
): AudioCaptureBackend | undefined {
  try {
    return requireFn(ADDON_ID) as AudioCaptureBackend;
  } catch (e) {
    console.warn(`[audio-sources] native capture addon unavailable: ${(e as Error).message}`);
    return undefined;
  }
}

export function backendNameFor(platform: NodeJS.Platform): AudioBackendName {
  switch (platform) {
    case 'linux':
      return 'pipewire';
    case 'darwin':
      return 'coreaudio';
    case 'win32':
      return 'wasapi';
    default:
      return 'none';
  }
}

/**
 * Derives what this host can do from the addon's own probes, and hands back the
 * process list the same probe already paid for: `devices()` throwing means no
 * usable audio session at all; `processes()` rejecting means per-app capture is
 * unavailable (OS below the floor) while system capture still works, and the
 * list is then empty. Every backend the addon ships can exclude the host's own
 * playback.
 */
export async function probeAudioSupport(
  backend: AudioCaptureBackend | undefined,
  platform: NodeJS.Platform,
): Promise<{ capabilities: AudioCapabilities; processes: JsProcessInfo[] }> {
  const name = backendNameFor(platform);
  if (!backend) {
    return {
      capabilities: {
        supported: false,
        perApp: false,
        canExcludeSelf: false,
        backend: name,
        reason: 'addon-unavailable',
      },
      processes: [],
    };
  }
  try {
    backend.devices();
  } catch (e) {
    return {
      capabilities: {
        supported: false,
        perApp: false,
        canExcludeSelf: false,
        backend: name,
        reason: (e as Error).message,
      },
      processes: [],
    };
  }
  try {
    const processes = await backend.processes();
    return {
      capabilities: { supported: true, perApp: true, canExcludeSelf: true, backend: name },
      processes,
    };
  } catch (e) {
    return {
      capabilities: {
        supported: true,
        perApp: false,
        canExcludeSelf: true,
        backend: name,
        reason: (e as Error).message,
      },
      processes: [],
    };
  }
}

/** The capabilities half of `probeAudioSupport`, for callers with no use for the process list. */
export async function probeAudioCapabilities(
  backend: AudioCaptureBackend | undefined,
  platform: NodeJS.Platform,
): Promise<AudioCapabilities> {
  return (await probeAudioSupport(backend, platform)).capabilities;
}
