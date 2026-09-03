/**
 * Composition of the `network.advanced` block of conductor-config.yaml.
 *
 * Kept apart from holochainManager.ts so the rules can be unit tested without
 * spawning a conductor: the block is a merge of settings from several unrelated
 * concerns (bootstrap backoff, space re-signing, dev-mode relays, LAN
 * discovery), and getting the merge wrong is silent -- the conductor starts
 * either way and only behaves differently on the network.
 */

/**
 * kitsune2's iroh transport module settings. Open-ended because Moss only sets
 * the few keys it cares about and must preserve whatever else is already in the
 * config file.
 */
export type IrohTransportSettings = {
  relayAllowPlainText?: boolean;
  enableLanDiscovery?: boolean;
  [key: string]: unknown;
};

/** kitsune2's mDNS bootstrap module settings. */
export type MdnsBootstrapSettings = {
  enabled: boolean;
  [key: string]: unknown;
};

/** The `network.advanced` block: one entry per kitsune2 module. */
export type AdvancedSettings = {
  coreBootstrap?: { backoffMaxMs: number };
  coreSpace?: { reSignExpireTimeMs: number; reSignFreqMs: number };
  mdnsBootstrap?: MdnsBootstrapSettings;
  irohTransport?: IrohTransportSettings;
  [key: string]: unknown;
};

export type AdvancedSettingsOptions = {
  /** `app.isPackaged` -- a dev build talks to local relays over plain http. */
  isPackaged: boolean;
  /** Whether peers should be discovered over mDNS on the local network. */
  mdnsEnabled: boolean;
};

/**
 * Returns the `network.advanced` block to write, given whatever the existing
 * config file already had there.
 *
 * `mdnsBootstrap` and `irohTransport.enableLanDiscovery` are the two halves of
 * LAN discovery: the first announces and browses for peers over mDNS, the second
 * lets the iroh transport actually dial the direct addresses that discovery
 * turns up. Both are written on every launch, `false` included -- the existing
 * config is read back and merged into, so omitting the keys when disabled would
 * leave a node that had them enabled once enabled forever.
 *
 * These are module keys that only a kitsune2 build carrying the mDNS bootstrap
 * module understands. Unknown module keys are ignored rather than rejected, so
 * the config this writes stays loadable by a stock holochain binary.
 */
export function composeAdvancedSettings(
  existing: AdvancedSettings | undefined,
  { isPackaged, mdnsEnabled }: AdvancedSettingsOptions,
): AdvancedSettings {
  const advanced: AdvancedSettings = { ...(existing ?? {}) };
  const irohTransport: IrohTransportSettings = { ...(advanced.irohTransport ?? {}) };

  // Development runs point at a locally spawned relay served over http://, which
  // the iroh transport refuses unless plain text is explicitly allowed.
  if (!isPackaged) irohTransport.relayAllowPlainText = true;

  irohTransport.enableLanDiscovery = mdnsEnabled;

  advanced.irohTransport = irohTransport;
  advanced.mdnsBootstrap = { ...(advanced.mdnsBootstrap ?? {}), enabled: mdnsEnabled };
  advanced.coreBootstrap = { backoffMaxMs: 30000 };
  advanced.coreSpace = { reSignExpireTimeMs: 30000, reSignFreqMs: 30000 };

  return advanced;
}
