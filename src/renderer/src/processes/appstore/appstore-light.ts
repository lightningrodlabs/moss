import { ActionHash, AgentPubKey, AppAgentClient } from '@holochain/client';
import { AppEntry, DevHubResponse, Entity, PublisherEntry } from './types.js';

export async function getAllApps(appstoreClient: AppAgentClient): Promise<Array<Entity<AppEntry>>> {
  const response: DevHubResponse<Array<Entity<AppEntry>>> = await appstoreClient.callZome({
    fn_name: 'get_all_apps',
    zome_name: 'appstore_api',
    role_name: 'appstore',
    payload: null,
  });
  return responseToPromise(response, 'getAllApps');
}

export async function createPublisher(
  appstoreClient: AppAgentClient,
  payload: PublisherInput,
): Promise<Entity<PublisherEntry>> {
  const response: DevHubResponse<Entity<PublisherEntry>> = await appstoreClient.callZome({
    role_name: 'appstore',
    zome_name: 'appstore_api',
    fn_name: 'create_publisher',
    payload,
  });
  return responseToPromise(response, 'createPublisher');
}

/** *
 * @param appstoreClient
 */
export async function getMyPublishers(
  appstoreClient: AppAgentClient,
): Promise<Entity<PublisherEntry>[]> {
  const response: DevHubResponse<Entity<PublisherEntry>[]> = await appstoreClient.callZome({
    role_name: 'appstore',
    zome_name: 'appstore_api',
    fn_name: 'get_my_publishers',
    payload: null,
  });
  return responseToPromise(response, 'getMyPublishers');
}

export async function createApp(
  appstoreClient: AppAgentClient,
  payload: CreateAppInput,
): Promise<DevHubResponse<Entity<AppEntry>>> {
  const response = await appstoreClient.callZome({
    role_name: 'appstore',
    zome_name: 'appstore_api',
    fn_name: 'create_app',
    payload,
  });
  return responseToPromise(response, 'createApp');
}

// updateApp --> check that URL is different but integrity hashes are the same

export async function getMyApps(appstoreClient: AppAgentClient): Promise<Entity<AppEntry>[]> {
  const response: DevHubResponse<Entity<AppEntry>[]> = await appstoreClient.callZome({
    role_name: 'appstore',
    zome_name: 'appstore_api',
    fn_name: 'get_my_apps',
    payload: null,
  });
  return responseToPromise(response, 'getMyApps');
}

export async function deprecateApp(
  appstoreClient: AppAgentClient,
  payload: DeprectaeInput,
): Promise<DevHubResponse<Entity<AppEntry>>> {
  const response = await appstoreClient.callZome({
    role_name: 'appstore',
    zome_name: 'appstore_api',
    fn_name: 'deprecate_app',
    payload,
  });
  return responseToPromise(response, 'createApp');
}

export function responseToPromise<T>(response: DevHubResponse<T>, caller: string): Promise<T> {
  switch (response.type) {
    case 'failure':
      return Promise.reject(`${caller} failed: ${response.payload}`);
    case 'success':
      return Promise.resolve(response.payload);
    default:
      return Promise.reject(`${caller} failed: Invalid response type.`);
  }
}

export interface CreateAppInput {
  title: string;
  subtitle: string;
  description: string;
  icon_src: string;
  publisher: ActionHash;
  /**
   * JSON string
   */
  source: string;
  /**
   * JSON string
   */
  hashes: string;
  metadata?: string;
  editors?: AgentPubKey[];
  published_at?: number;
  last_updated?: number;
}

export interface PublisherInput {
  name: string;
  location: {
    country: string;
    region: string;
    city: string;
  };
  website: {
    url: string;
    context?: any;
  };
  icon_src: string;
  description?: string;
  email?: string;
  editors?: AgentPubKey[];
  published_at?: number;
  last_updated?: number;
  metadata?: string;
}

export type WebHappSource = {
  type: 'https';
  url: string;
};

export interface DeprectaeInput {
  base: ActionHash;
  message: string;
}
