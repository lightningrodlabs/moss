/**
 * Environment for the in-process PipeWire clients that the audio capture addon
 * brings into Moss. The ALSA plugins that cpal enumerates devices through open
 * their PipeWire contexts with `client-rt.conf`, which loads
 * `libpipewire-module-rt`: a realtime-priority thread plus an rtkit D-Bus
 * request per context, torn down again when enumeration ends. Capture for
 * transcription needs no realtime thread, and that module's teardown has
 * faulted inside Moss on PipeWire 1.0. `client.conf` loads the same protocol
 * modules without it. A name the user chose stays.
 */
export function pipewireClientConfigEnv(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): Record<string, string> {
  if (platform !== 'linux') return {};
  if (env.PIPEWIRE_CONFIG_NAME) return {};
  return { PIPEWIRE_CONFIG_NAME: 'client.conf' };
}
