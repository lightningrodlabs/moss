import { msg } from '@lit/localize';
import { isInitTimeoutError } from '@theweave/utils';

/**
 * Turns a conductor error into a sentence a person can act on. The conductor's own
 * wording for a slow first-time setup or a client timeout means nothing to a user.
 */
export function conductorErrorMessage(error: unknown): string {
  if (isInitTimeoutError(error)) {
    return msg(
      'Moss is still setting up this group. This can take a minute the first time. Use Retry if it does not finish on its own.',
    );
  }
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('Request timed out')) {
    return msg('The group did not answer in time. Use Retry.');
  }
  return text;
}
