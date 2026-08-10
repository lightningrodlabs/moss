export const TOOLS_LIBRARY_APP_ID = 'default-app#tool-library';

/**
 * The Weave protocol version this Moss version speaks.
 *
 * It is the single source of truth for the OS deep link scheme, the invite code
 * format and the weave URLs handed to applets. Bumping it makes this Moss version
 * claim its own deep link scheme, so that links produced by a Moss version with an
 * incompatible group DNA are rejected instead of silently opened.
 *
 * The scheme is also declared as a literal in `electron-builder.yml`; the two are
 * kept in sync by a unit test.
 */
export const WEAVE_PROTOCOL_VERSION = '0.16';

/** OS-registered URL scheme for deep links, e.g. `weave-0.16`. */
export const WEAVE_URL_SCHEME = `weave-${WEAVE_PROTOCOL_VERSION}`;

/** Prefix of every weave deep link, e.g. `weave-0.16://`. */
export const WEAVE_URL_PREFIX = `${WEAVE_URL_SCHEME}://`;

/**
 * Deep link schemes that earlier builds of this Moss version claimed and that now belong
 * to a different Moss version. Released on startup so those links reach the Moss version
 * whose group DNA can actually open them.
 *
 * Reset this whenever WEAVE_PROTOCOL_VERSION is bumped: it should list the schemes the
 * *previous* version of this file claimed, not accumulate every past scheme. A unit test
 * enforces that it never contains the current scheme.
 */
export const SUPERSEDED_URL_SCHEMES = ['weave-0.15'];

/** Web page that forwards a weave URL passed in its query string to the desktop app. */
export const WEAVE_WEB_PREFIX = 'https://theweave.social/wal?';
