import { encode } from '@msgpack/msgpack';
import type { RoleProperties } from '@theweave/moss-types';

/**
 * Builds the per-role properties a dev-config applet instance is registered
 * with: each overridden role gets the manifest defaults with the dev config's
 * values on top, msgpack-encoded as the group's Applet entry stores them.
 * Roles the dev config does not mention are left out so the conductor keeps
 * their manifest defaults.
 */
export function encodeRoleOverrides(
  manifestDefaults: RoleProperties,
  overrides: RoleProperties | undefined,
): Record<string, Uint8Array> {
  if (!overrides) return {};
  return Object.fromEntries(
    Object.entries(overrides).map(([role, props]) => [
      role,
      encode({ ...(manifestDefaults[role] ?? {}), ...props }),
    ]),
  );
}
