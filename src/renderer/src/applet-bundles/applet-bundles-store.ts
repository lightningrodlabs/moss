import { asyncDerived, lazyLoadAndPoll, pipe, retryUntilSuccess } from '@holochain-open-dev/stores';
import { LazyHoloHashMap } from '@holochain-open-dev/utils';
import { ActionHash, AdminWebsocket, AppAgentClient } from '@holochain/client';
import {
  getHappReleases,
  getVisibleHostsForZomeFunction,
} from '../processes/appstore/get-happ-releases.js';
import {
  AppEntry,
  DevHubResponse,
  Entity,
  HappReleaseEntry,
  HostAvailability,
} from '../processes/appstore/types.js';
import { ConductorInfo } from '../electron-api.js';
import { fromUint8Array } from 'js-base64';
import { getAllApps } from '../processes/appstore/appstore-light.js';

export class AppletBundlesStore {
  constructor(
    public appstoreClient: AppAgentClient,
    public adminWebsocket: AdminWebsocket,
    public conductorInfo: ConductorInfo,
  ) {}

  allAppletBundles = lazyLoadAndPoll(async () => getAllApps(this.appstoreClient), 30000);

  appletBundles = new LazyHoloHashMap((appletBundleHash: ActionHash) =>
    asyncDerived(this.allAppletBundles, async (appletBundles) => {
      const appletBundle = appletBundles.find(
        (app) => app.id.toString() === appletBundleHash.toString(),
      );
      return appletBundle;
    }),
  );

  appletBundleLogo = new LazyHoloHashMap((appletBundleHash: ActionHash) =>
    pipe(this.appletBundles.get(appletBundleHash), (appEntry) =>
      retryUntilSuccess(async () => {
        if (!appEntry) throw new Error("Can't find app bundle");

        const icon: string = await this.fetchIcon(appEntry.id);

        if (!icon) throw new Error('Icon was not found');

        return icon;
      }),
    ),
  );

  async getAppEntry(appActionHash: ActionHash) {
    const appEntryEntity: DevHubResponse<Entity<AppEntry>> = await this.appstoreClient.callZome({
      role_name: 'appstore',
      zome_name: 'appstore_api',
      fn_name: 'get_app',
      payload: {
        id: appActionHash,
      },
    });
    return appEntryEntity.payload;
  }

  async fetchIcon(appActionHash: ActionHash) {
    const appEntryEntity = await this.getAppEntry(appActionHash);
    const appEntry = appEntryEntity.content;
    const essenceResponse = await this.appstoreClient.callZome({
      role_name: 'appstore',
      zome_name: 'mere_memory_api',
      fn_name: 'retrieve_bytes',
      payload: appEntry.icon.bytes,
    });
    const mimeType = appEntry.icon.mime_type;

    const base64String = fromUint8Array(Uint8Array.from(essenceResponse.payload));

    const iconSrc = `data:${mimeType};base64,${base64String}`;

    return iconSrc;
  }
}
