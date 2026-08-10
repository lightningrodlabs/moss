import { msg, str } from '@lit/localize';
import { InviteParseError, isInviteLink } from '@theweave/utils';
import { WEAVE_PROTOCOL_VERSION } from '@theweave/moss-types';

/**
 * Explains a weave link made by a Moss version whose group DNA this version cannot
 * reach. Invites and asset links fail for the same reason but call for different
 * actions: an invite can be re-requested, an asset link points at content that only
 * exists in the other version.
 */
export function foreignVersionLinkMessage(link: string, foundVersion: string): string {
  if (isInviteLink(link)) {
    return inviteErrorMessage(
      new InviteParseError('version-mismatch', `Link is for Moss ${foundVersion}.`, foundVersion),
    );
  }
  return msg(
    str`This link was created by Moss ${foundVersion} and points to content Moss ${WEAVE_PROTOCOL_VERSION} cannot open. Open it in Moss ${foundVersion}.`,
  );
}

/**
 * Turns an invite parse failure into something a user can act on.
 *
 * The version mismatch case matters most: group DNAs differ between Moss versions, so
 * joining with an invite from another version would produce a group that looks joined
 * but never finds its peers. The message has to say that the invite is for a different
 * Moss version rather than that it is invalid.
 */
export function inviteErrorMessage(e: unknown): string {
  if (!(e instanceof InviteParseError)) {
    return msg(
      'Could not read that invite. Paste the full invite link or invite code you were given.',
    );
  }
  switch (e.reason) {
    case 'version-mismatch':
      return e.foundVersion
        ? msg(
            str`This invite is for Moss ${e.foundVersion} and cannot be used to join a group from Moss ${WEAVE_PROTOCOL_VERSION}. Ask for an invite created in Moss ${WEAVE_PROTOCOL_VERSION}, or install Moss ${e.foundVersion} to join that group.`,
          )
        : msg(
            str`This invite was created by a different version of Moss and cannot be used to join a group from Moss ${WEAVE_PROTOCOL_VERSION}.`,
          );
    case 'invalid-seed':
      return msg('This invite is incomplete. Ask the sender for the full invite link or code.');
    case 'invalid-progenitor':
      return msg('This invite is damaged. Ask the sender for a new invite link or code.');
    case 'wrong-format':
    default:
      return msg(
        'That does not look like a Moss invite. Paste the full invite link or invite code you were given.',
      );
  }
}
