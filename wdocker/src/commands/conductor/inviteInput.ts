import { InviteParseError, looksLikeInviteCode } from '@theweave/utils';

/**
 * Whether the invite argument looks like a link the shell truncated because it
 * was passed unquoted: `&` backgrounds the command, so everything from
 * `&progenitor` onwards never reaches the CLI. Invite codes carry no `&` and
 * are complete as pasted, so they must not trigger the hint.
 */
export function shouldWarnAboutQuoting(input: string): boolean {
  if (looksLikeInviteCode(input)) return false;
  return input.includes('weave-') && !input.includes('&progenitor');
}

/**
 * A single-line description of why join-group failed. Programmatic callers read
 * this off stderr, so an invite that could not be parsed carries its reason tag
 * for them to branch on.
 */
export function describeJoinGroupError(error: unknown): string {
  if (error instanceof InviteParseError) {
    return `invalid invite (${error.reason}): ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
