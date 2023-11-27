import {
  AgentPubKey,
  AnyDhtHash,
  AnyDhtHashB64,
  AppAgentClient,
  DnaHash,
  DnaHashB64,
} from '@holochain/client';
import {
  CustomRemoteCallInput,
  DevHubResponse,
  Entity,
  HappReleaseEntry,
  HostAvailability,
  HostEntry,
  Response,
} from './types.js';

export interface ResourceLocator {
  dna_hash: DnaHash;
  resource_hash: AnyDhtHash;
}
export interface ResourceLocatorB64 {
  dna_hash: DnaHashB64;
  resource_hash: AnyDhtHashB64;
}

/**
 * Get happ releases for a happ. Searches for an online DevHub host first.
 *
 * ATTENTION: This returns just an empty array if there is no happ entry found at
 * the requested entry hash
 *
 * @param appWebsocket
 * @param appStoreApp
 * @param forHapp
 * @returns
 */
export async function getHappReleases(
  appstoreClient: AppAgentClient,
  forHapp: ResourceLocator,
): Promise<Array<Entity<HappReleaseEntry>>> {
  try {
    return remoteCallCascadeToAvailableHosts(
      appstoreClient,
      forHapp.dna_hash,
      'happ_library',
      'get_happ_releases',
      { for_happ: forHapp.resource_hash },
    );
  } catch (e) {
    throw new Error(`Failed to get happ releases: ${JSON.stringify(e)}`);
  }
}

/**
 * Get happ releases for a happ from a specific DevHub host
 * @param appWebsocket
 * @param appStoreApp
 * @param host
 * @param forHapp
 */
export async function getHappReleasesFromHost(
  appstoreClient: AppAgentClient,
  host: AgentPubKey,
  forHapp: ResourceLocator,
): Promise<Array<Entity<HappReleaseEntry>>> {
  const payload = {
    for_happ: forHapp.resource_hash,
  };

  return remoteCallToDevHubHost<Array<Entity<HappReleaseEntry>>>(
    appstoreClient,
    forHapp.dna_hash,
    host,
    'happ_library',
    'get_happ_releases',
    payload,
  );
}

/**
 * Remote call to DevHub host
 *
 * 1. get all registered hosts for the given zome function via the get_hosts_for_zome_function zome call
 *
 * 2. for each of those hosts, send a ping via portal_api/ping zome function, with Promise.any()
 *
 * 3. return the first that responds to the ping
 *
 */
export async function getAvailableHostForZomeFunction(
  appstoreClient: AppAgentClient,
  devhubDna: DnaHash,
  zome_name: string,
  fn_name: string,
): Promise<AgentPubKey> {
  try {
    const hosts = await getHostsForZomeFunction(appstoreClient, devhubDna, zome_name, fn_name);

    // 2. ping each of them and take the first one that responds
    try {
      const availableHost = await Promise.any(
        hosts.map(async (hostEntry) => {
          const hostPubKey = hostEntry.author;
          // console.log("@getAvailableHostForZomeFunction: trying to ping host: ", encodeHashToBase64(hostPubKey));

          try {
            const result: Response<any> = await appstoreClient.callZome({
              role_name: 'portal',
              fn_name: 'ping',
              zome_name: 'portal_api',
              payload: hostPubKey,
            });

            if (result.type === 'failure') {
              throw new Error(`Failed to ping host: ${result.payload}`);
            }
          } catch (e) {
            // console.error("Failed to ping host: ", e);
            throw new Error('Failed to ping host.');
          }
          // what happens in the "false" case? Can this happen?

          return hostPubKey;
        }),
      );

      return availableHost;
    } catch (e) {
      throw new Error('No available peer host found.');
    }
  } catch (e) {
    throw new Error(
      `Failed to get available host for zome ${zome_name} and function ${fn_name}: ${JSON.stringify(
        e,
      )}`,
    );
  }
}
export async function getVisibleHostsForZomeFunction(
  appstoreClient: AppAgentClient,
  devhubDna: DnaHash,
  zome_name: string,
  fn_name: string,
  timeoutMs: number = 4000,
): Promise<HostAvailability> {
  const responded: AgentPubKey[] = [];

  const pingTimestamp = Date.now();

  try {
    const hosts = await getHostsForZomeFunction(appstoreClient, devhubDna, zome_name, fn_name);

    // 2. ping each of them and take the first one that responds
    await Promise.allSettled(
      hosts.map(async (hostEntry) => {
        try {
          // consider hosts that do not respond after 6 seconds as offline
          const result = await appstoreClient.callZome(
            {
              role_name: 'portal',
              fn_name: 'ping',
              zome_name: 'portal_api',
              payload: hostEntry.author,
            },
            timeoutMs,
          );

          if (result.type === 'failure') {
            throw new Error(`Failed to ping host: ${result.payload}`);
          }

          responded.push(hostEntry.author);
        } catch (e) {
          throw new Error(`Failed to ping host: ${e}`);
        }
      }),
    );

    return {
      responded,
      totalHosts: hosts.length,
      pingTimestamp,
    };
  } catch (e) {
    throw new Error(
      `Failed to get visible hosts for zome ${zome_name} and function ${fn_name}: ${e}`,
    );
  }
}

/**
 * Gets all the hosts that registered to grant remote calls for the given zome function
 *
 * @param appWebsocket
 * @param appStoreApp
 * @param zome_name
 * @param fn_name
 * @returns
 */
export async function getHostsForZomeFunction(
  appstoreClient: AppAgentClient,
  devhubDna: DnaHash,
  zome_name: string,
  fn_name: string,
): Promise<Array<HostEntry>> {
  // 1. get all registered hosts for this zome function
  const hosts: DevHubResponse<Array<Entity<HostEntry>>> = await appstoreClient.callZome({
    role_name: 'portal',
    fn_name: 'get_hosts_for_zome_function',
    zome_name: 'portal_api',
    payload: {
      dna: devhubDna,
      zome: zome_name,
      function: fn_name,
    },
  });

  return hosts.payload.map((host) => host.content);
}

/**
 * Makes a remote call to a specified DevHub host for the specified function and zome and with the
 * specified payload
 *
 * @param appWebsocket
 * @param appStoreApp
 * @param devhubDna
 * @param host
 * @param fn_name
 * @param zome_name
 * @param payload
 * @returns
 */
export async function remoteCallToDevHubHost<T>(
  appstoreClient: AppAgentClient,
  devhubDna: DnaHash,
  host: AgentPubKey, // public key of the devhub host to call to
  zome_name: string,
  fn_name: string,
  payload: any,
): Promise<T> {
  const input: CustomRemoteCallInput = {
    host,
    call: {
      dna: devhubDna,
      zome: zome_name,
      function: fn_name,
      payload,
    },
  };

  const response: DevHubResponse<DevHubResponse<T>> = await appstoreClient.callZome({
    role_name: 'portal',
    fn_name: 'custom_remote_call',
    zome_name: 'portal_api',
    payload: input,
  });

  if (response.type === 'success') {
    if (response.payload.type === 'success') {
      return response.payload.payload;
    } else {
      throw new Error(
        `remote call for function '${fn_name}' of zome '${zome_name}' failed: ${JSON.stringify(
          response.payload.payload,
        )}`,
      );
    }
  } else {
    throw new Error(
      `remote call for function '${fn_name}' of zome '${zome_name}' failed: ${JSON.stringify(
        response.payload,
      )}`,
    );
  }
}

/**
 * Helper function to make a remote call to first responsive host. It is possible
 * that this host does not have the app synchronized and thus is unable to deliver it.
 * In that case, other hosts should be tried which is not supported by this function.
 *
 * @param appWebsocket
 * @param appStoreApp
 * @param devhubDna
 * @param zome_name
 * @param fn_name
 * @param payload
 */
export async function remoteCallToAvailableHost<T>(
  appstoreClient: AppAgentClient,
  devhubDna: DnaHash,
  zome_name: string,
  fn_name: string,
  payload: any,
): Promise<T> {
  const host: AgentPubKey = await getAvailableHostForZomeFunction(
    appstoreClient,
    devhubDna,
    zome_name,
    fn_name,
  );

  return remoteCallToDevHubHost<T>(appstoreClient, devhubDna, host, zome_name, fn_name, payload);
}

/**
 * Helper function to make a remote call to hosts in a cascading manner, i.e. if the first
 * responsive host fails to deliver the promise, go on to proceeding hosts etc.
 *
 * WARNING: Untested.
 *
 * @param appWebsocket
 * @param appStoreApp
 * @param devhubDna
 * @param zome_name
 * @param fn_name
 * @param payload
 */
export async function remoteCallCascadeToAvailableHosts<T>(
  appstoreClient: AppAgentClient,
  devhubDna: DnaHash,
  zome_name: string,
  fn_name: string,
  payload: any,
  pingTimeout: number = 3000, // hosts that do not respond to the ping quicker than this are ignored
): Promise<T> {
  const pingResult = await getVisibleHostsForZomeFunction(
    appstoreClient,
    devhubDna,
    zome_name,
    fn_name,
    pingTimeout,
  );

  const availableHosts = pingResult.responded;

  const errors: any[] = [];

  // for each host, try to get stuff and if it succeeded, return,
  // otherwise go to next host
  for (const host of availableHosts) {
    try {
      const response = await remoteCallToDevHubHost<T>(
        appstoreClient,
        devhubDna,
        host,
        zome_name,
        fn_name,
        payload,
      );

      return response;
    } catch (e) {
      errors.push(e);
    }
  }

  throw new Error(
    `Failed to do remote call for function '${fn_name}' of zome '${zome_name}' for all available hosts.\nErrors: ${errors}`,
  );
}

export async function tryWithHosts<T>(
  fn: (host: AgentPubKey) => Promise<T>,
  appstoreClient: AppAgentClient,
  devhubDna: DnaHash,
  zome_name: string,
  fn_name: string,
  pingTimeout: number = 3000,
): Promise<T> {
  // try with first responding host
  const host: AgentPubKey = await getAvailableHostForZomeFunction(
    appstoreClient,
    devhubDna,
    zome_name,
    fn_name,
  );

  try {
    // console.log("@tryWithHosts: trying with first responding host: ", encodeHashToBase64(host));
    const result = await fn(host);
    return result;
  } catch (e) {
    const errors: any[] = [];
    errors.push(e);

    // console.log("@tryWithHosts: Failed with first host: ", JSON.stringify(e));
    // if it fails with the first host, try other hosts
    const pingResult = await getVisibleHostsForZomeFunction(
      appstoreClient,
      devhubDna,
      zome_name,
      fn_name,
      pingTimeout,
    );

    const availableHosts = pingResult.responded;

    // for each host, try to get stuff and if it succeeded, return,
    // otherwise go to next host
    for (const otherHost of availableHosts) {
      try {
        // console.log("@tryWithHosts: retrying with other host: ", encodeHashToBase64(otherHost));
        const response = await fn(otherHost);
        return response;
      } catch (e) {
        errors.push(e);
      }
    }

    throw new Error(
      `Callback for function '${fn_name}' of zome '${zome_name}' failed for all available hosts.\nErrors: ${JSON.stringify(
        errors,
      )}`,
    );
  }
}
