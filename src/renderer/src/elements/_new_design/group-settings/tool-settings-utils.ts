import { EntryHash } from '@holochain/client';
import { GroupStore } from '../../../groups/group-store';
import { notify, notifyError } from '@holochain-open-dev/elements';
import { msg } from '@lit/localize';

export async function deprecateTool(groupStore: GroupStore, appletHash: EntryHash) {
  try {
    await groupStore.groupClient.archiveApplet(appletHash);
    await groupStore.allAdvertisedApplets.reload();
    notify(msg('Tool deprecated.'));
  } catch (e) {
    notifyError(msg('Failed to deprecate tool (see console for details)'));
    console.error(e);
  }
}

export async function undeprecateTool(groupStore: GroupStore, appletHash: EntryHash) {
  try {
    await groupStore.groupClient.unarchiveApplet(appletHash);
    await groupStore.allAdvertisedApplets.reload();
    notify(msg('Tool undeprecated.'));
  } catch (e) {
    notifyError(msg('Failed to undeprecate tool (see console for details)'));
    console.error(e);
  }
}
