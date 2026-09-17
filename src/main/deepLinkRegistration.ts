import path from 'path';

/** The subset of Electron's `app` that registers URL scheme handlers with the OS. */
export interface UrlSchemeRegistry {
  setAsDefaultProtocolClient(scheme: string, execPath?: string, args?: string[]): boolean;
  removeAsDefaultProtocolClient(scheme: string): boolean;
}

export interface DeepLinkRegistrationOptions {
  platform: NodeJS.Platform;
  /** The scheme this Moss version answers to, e.g. `weave-0.16`. */
  scheme: string;
  /** Schemes earlier builds of this version claimed and should hand back. */
  supersededSchemes: readonly string[];
  /** True when running unpackaged via `electron <script>`. */
  defaultApp: boolean;
  execPath: string;
  argv: readonly string[];
}

/**
 * Claims this Moss version's own deep link scheme, so that links made by a Moss version
 * with an incompatible group DNA are routed to the version that can open them, and
 * releases the schemes earlier builds of this version claimed.
 *
 * On Linux the desktop file installed alongside the app already advertises the scheme in
 * its MimeType entry, which is what the desktop environment consults, so nothing is
 * registered at runtime. Electron would otherwise run `xdg-settings set
 * default-url-scheme-handler`, and the xdg-utils 1.1.3 that Ubuntu ships also makes the
 * app the default text/html handler on GNOME when asked for a scheme.
 */
export function registerDeepLinkSchemes(
  registry: UrlSchemeRegistry,
  options: DeepLinkRegistrationOptions,
): void {
  if (options.platform === 'linux') return;

  if (options.defaultApp) {
    if (options.argv.length >= 2) {
      registry.setAsDefaultProtocolClient(options.scheme, options.execPath, [
        path.resolve(options.argv[1]),
      ]);
    }
  } else {
    registry.setAsDefaultProtocolClient(options.scheme);
  }

  // Releasing is a no-op unless this executable is the currently registered handler, so
  // an installed older Moss is left alone.
  for (const scheme of options.supersededSchemes) {
    try {
      registry.removeAsDefaultProtocolClient(scheme);
    } catch (e) {
      console.warn(`Failed to release protocol scheme ${scheme}: `, e);
    }
  }
}
