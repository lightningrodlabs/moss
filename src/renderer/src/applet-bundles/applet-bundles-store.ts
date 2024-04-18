import {
  asyncDerived,
  lazyLoad,
  lazyLoadAndPoll,
  pipe,
  retryUntilSuccess,
} from '@holochain-open-dev/stores';
import { EntryRecord, LazyHoloHashMap } from '@holochain-open-dev/utils';
import {
  ActionHash,
  AdminWebsocket,
  AppAgentClient,
  DnaHashB64,
  Record as HolochainRecord,
  encodeHashToBase64,
} from '@holochain/client';
import { ConductorInfo } from '../electron-api.js';
import { getAllApps, responseToPromise } from '../processes/appstore/appstore-light.js';
import { AppEntry, DevHubResponse, Entity, PublisherEntry } from '../processes/appstore/types.js';

export class AppletBundlesStore {
  constructor(
    public appstoreClient: AppAgentClient,
    public adminWebsocket: AdminWebsocket,
    public conductorInfo: ConductorInfo,
  ) {}

  installableAppletBundles = lazyLoadAndPoll(async () => getAllApps(this.appstoreClient), 30000);

  appletBundles = new LazyHoloHashMap((appletBundleHash: ActionHash) =>
    asyncDerived(this.installableAppletBundles, async (appletBundles) =>
      appletBundles.find((app) => app.id.toString() === appletBundleHash.toString()),
    ),
  );

  appletBundleLogo = new LazyHoloHashMap((appletBundleHash: ActionHash) =>
    pipe(this.appletBundles.get(appletBundleHash), (appEntry) =>
      retryUntilSuccess(async () => {
        if (!appEntry)
          throw new Error(
            `Can't find app bundle for hash: ${encodeHashToBase64(appletBundleHash)}`,
          );

        const icon: string = await this.fetchIcon(appEntry.action);

        if (!icon) throw new Error('Icon was not found');

        return icon;
      }),
    ),
  );

  allPublishers = new LazyHoloHashMap((publisherHash: ActionHash) =>
    lazyLoad(async () => this._getPublisher(publisherHash)),
  );

  private async _getPublisher(id: ActionHash): Promise<Entity<PublisherEntry>> {
    const response: DevHubResponse<Entity<PublisherEntry>> = await this.appstoreClient.callZome({
      role_name: 'appstore',
      zome_name: 'appstore_api',
      fn_name: 'get_publisher',
      payload: { id },
    });
    return responseToPromise(response, 'get_publisher');
  }

  async getAppEntry(appActionHash: ActionHash): Promise<EntryRecord<AppEntry>> {
    const record: HolochainRecord | undefined = await this.appstoreClient.callZome({
      role_name: 'appstore',
      zome_name: 'appstore_api',
      fn_name: 'get_record',
      payload: appActionHash,
    });
    if (!record) throw new Error('Record not found for acion hash.');
    return new EntryRecord(record);
  }

  async getLatestAppEntry(appEntryId: ActionHash): Promise<Entity<AppEntry>> {
    const response: DevHubResponse<Entity<AppEntry>> = await this.appstoreClient.callZome({
      role_name: 'appstore',
      zome_name: 'appstore_api',
      fn_name: 'get_app',
      payload: { id: appEntryId },
    });
    return responseToPromise(response, 'getLatestAppEntry');
  }

  async fetchIcon(appActionHash: ActionHash) {
    const appEntryRecord = await this.getAppEntry(appActionHash);
    const appEntry = appEntryRecord.entry;
    return appEntry.icon_src;
  }

  async appstoreDnaHash(): Promise<DnaHashB64> {
    const appStoreAppInfo = await this.appstoreClient.appInfo();
    if (!appStoreAppInfo) throw new Error('Appstore AppInfo is null.');
    let appstoreDnaHash: DnaHashB64 | undefined = undefined;
    for (const [_role_name, [cell]] of Object.entries(appStoreAppInfo.cell_info)) {
      appstoreDnaHash = encodeHashToBase64(cell['provisioned'].cell_id[0]);
    }
    if (!appstoreDnaHash)
      throw new Error('Failed to install applet: Failed to get appstore DNA hash.');
    return appstoreDnaHash;
  }
}
