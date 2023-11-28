import { asyncDerived, lazyLoadAndPoll, pipe, retryUntilSuccess } from '@holochain-open-dev/stores';
import { LazyHoloHashMap } from '@holochain-open-dev/utils';
import { ActionHash, AdminWebsocket, AppAgentClient, encodeHashToBase64 } from '@holochain/client';
import { invoke } from '@tauri-apps/api';
import {
  getHappReleases,
  getVisibleHostsForZomeFunction,
} from '../processes/appstore/get-happ-releases.js';
import { getAllApps } from '../processes/appstore/get-happs.js';
import {
  AppEntry,
  Entity,
  HappReleaseEntry,
  HostAvailability,
} from '../processes/appstore/types.js';
import { ConductorInfo } from '../electron-api.js';

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

        const icon: string = await invoke('fetch_icon', {
          appActionHashB64: encodeHashToBase64(appEntry.id),
        });

        if (!icon) throw new Error('Icon was not found');

        return icon;
      }),
    ),
  );

  async getVisibleHosts(appEntry: Entity<AppEntry>): Promise<HostAvailability> {
    return getVisibleHostsForZomeFunction(
      this.appstoreClient,
      appEntry.content.devhub_address.dna,
      'happ_library',
      'get_webhapp_package', // TODO change to 'get_webasset_file' once fetching in chunks is implemented
      4000,
    );
  }

  async getLatestVersion(appEntry: Entity<AppEntry>): Promise<Entity<HappReleaseEntry>> {
    const appReleases = await getHappReleases(this.appstoreClient, {
      dna_hash: appEntry.content.devhub_address.dna,
      resource_hash: appEntry.content.devhub_address.happ,
    });

    if (appReleases.length === 0) throw new Error("This app doesn't have any releases yet.");

    const latestRelease = appReleases.sort(
      (happRelease1, happRelease2) => happRelease2.content.ordering - happRelease1.content.ordering,
    )[0];

    if (!latestRelease.content.official_gui)
      throw new Error("This app doesn't have an official GUI.");

    return latestRelease;
  }
}
