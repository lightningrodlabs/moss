import type { AudioCapabilities } from '@theweave/moss-types';

/**
 * Whether the iframe config tells a Tool that audio-source capture is on
 * offer here: the Audio Sources service switch is on AND the host's backend
 * answered its capability probe. The applet iframe attaches
 * `captureAudioSources` only when this is true, so a Tool's feature
 * detection (`client.captureAudioSources?.`) means "this host can capture
 * for me now" and a Tool never shows a capture control whose request the
 * host would answer with a silent `null` (`AudioSourceGrantsClient.request`
 * on the switch, `AudioSourceGrants.request` on an unloaded backend) — a
 * result the Tool cannot tell from the user cancelling.
 *
 * Read when the iframe asks for its config, so a switch flipped while a
 * Tool is open takes effect at that Tool's next load; the request path
 * honours the switch live.
 *
 * The switch is read first: a host with the service off never pays for the
 * probe. A probe that throws reads as unavailable: hiding the control on a
 * broken probe is the safe side, and the iframe must still get its config.
 */
export async function audioCaptureAvailable(
  enabled: () => boolean,
  probe: () => Promise<AudioCapabilities>,
  warn: (message: string) => void = (m) => console.warn(m),
): Promise<boolean> {
  if (!enabled()) return false;
  try {
    return (await probe()).supported;
  } catch (e) {
    warn(`[audio-sources] capability probe failed; reporting capture as unavailable: ${(e as Error).message}`);
    return false;
  }
}
