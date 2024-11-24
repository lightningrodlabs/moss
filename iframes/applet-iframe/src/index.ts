import { ProfilesClient } from '@holochain-open-dev/profiles';
import { EntryHashMap, HoloHashMap, parseHrl } from '@holochain-open-dev/utils';
import {
  ActionHash,
  AgentPubKeyB64,
  AppAuthenticationToken,
  AppClient,
  AppWebsocket,
  CallZomeRequest,
  CallZomeRequestSigned,
  EntryHash,
  decodeHashFromBase64,
  encodeHashToBase64,
} from '@holochain/client';
import { decode } from '@msgpack/msgpack';
import { toUint8Array } from 'js-base64';
import {
  WeaveServices,
  IframeConfig,
  Hrl,
  WAL,
  FrameNotification,
  RenderView,
  RenderInfo,
  AppletToParentMessage,
  ParentToAppletMessage,
  AppletHash,
  AppletServices,
  OpenAssetMode,
  CreatableName,
  CreatableType,
  RecordInfo,
  NULL_HASH,
  PeerStatusUpdate,
  PeerStatus,
  ReadonlyPeerStatusStore,
  AppletToParentRequest,
  AppletId,
  AssetStoreContent,
  stringifyWal,
} from '@theweave/api';
import { AsyncStatus, readable } from '@holochain-open-dev/stores';
import { toOriginalCaseB64 } from '@theweave/utils';

type CallbackWithId = {
  id: number;
  callback: () => any;
};

declare global {
  interface Window {
    __WEAVE_API__: WeaveServices;
    __WEAVE_APPLET_SERVICES__: AppletServices;
    __WEAVE_RENDER_INFO__: RenderInfo;
    __WEAVE_APPLET_HASH__: AppletHash;
    __WEAVE_APPLET_ID__: AppletId;
    __WEAVE_PROTOCOL_VERSION__: string;
    __MOSS_VERSION__: string;
    __WEAVE_ON_BEFORE_UNLOAD_CALLBACKS__: Array<CallbackWithId> | undefined;
  }

  interface WindowEventMap {
    'peer-status-update': CustomEvent<PeerStatusUpdate>;
    'asset-store-update': CustomEvent<{
      type: 'asset-store-update';
      walStringified: string;
      value: AsyncStatus<AssetStoreContent>;
    }>;
    'remote-signal-received': CustomEvent<Uint8Array>;
  }
}

const weaveApi: WeaveServices = {
  assets: {
    assetInfo: (wal: WAL) =>
      postMessage({
        type: 'get-global-asset-info',
        wal,
      }),
    assetToPocket: (wal: WAL) =>
      postMessage({
        type: 'asset-to-pocket',
        wal,
      }),
    dragAsset: (wal: WAL) =>
      postMessage({
        type: 'drag-asset',
        wal,
      }),
    userSelectAsset: () =>
      postMessage({
        type: 'user-select-asset',
      }),
    addTagsToAsset: (wal, tags) =>
      postMessage({
        type: 'add-tags-to-asset',
        wal,
        tags,
      }),
    removeTagsFromAsset: (wal, tags) =>
      postMessage({
        type: 'remove-tags-from-asset',
        wal,
        tags,
      }),
    addAssetRelation: (srcWal, dstWal, tags) =>
      postMessage({
        type: 'add-asset-relation',
        srcWal,
        dstWal,
        tags,
      }),
    removeAssetRelation: (relationHash) =>
      postMessage({
        type: 'remove-asset-relation',
        relationHash,
      }),
    addTagsToAssetRelation: (relationHash, tags) =>
      postMessage({
        type: 'add-tags-to-asset-relation',
        relationHash,
        tags,
      }),
    removeTagsFromAssetRelation: (relationHash, tags) =>
      postMessage({
        type: 'remove-tags-from-asset-relation',
        relationHash,
        tags,
      }),
    assetStore: (wal) => {
      const readableStore = readable<AsyncStatus<AssetStoreContent>>(
        { status: 'pending' },
        (set) => {
          const listener = (
            e: CustomEvent<{
              type: 'asset-store-update';
              walStringified: string;
              value: AsyncStatus<AssetStoreContent>;
            }>,
          ) => {
            // Check whether the WAL is meant for the given store
            if (stringifyWal(wal) === e.detail.walStringified) {
              console.log(
                '@applet-iframe: got asset-store-update event for the correct wal and resetting the store.',
              );
              set(e.detail.value);
            }
          };
          window.addEventListener('asset-store-update', listener);
          return () => {
            // TODO verify that this does not remove the event listener for other
            // subscribers to the same WAL
            window.removeEventListener('asset-store-update', listener);
            console.log('UNSUBSCRIBING.');
            setTimeout(async () => {
              await postMessage({
                type: 'unsubscribe-from-asset-store',
                wal,
              });
            });
          };
        },
      );
      setTimeout(async () => {
        await postMessage({
          type: 'subscribe-to-asset-store',
          wal,
        });
      });
      return readableStore;
    },
  },

  mossVersion: () => {
    return window.__MOSS_VERSION__;
  },

  onPeerStatusUpdate: (callback: (payload: PeerStatusUpdate) => any) => {
    const listener = (e: CustomEvent<PeerStatusUpdate>) => callback(e.detail);
    window.addEventListener('peer-status-update', listener);
    return () => window.removeEventListener('peer-status-update', listener);
  },

  onBeforeUnload: (callback: () => void) => {
    // registers a callback on the window object that will be called before
    // the iframe gets unloaded
    const existingCallbacks = window.__WEAVE_ON_BEFORE_UNLOAD_CALLBACKS__ || [];
    let newCallbackId = 0;
    const existingCallbackIds = existingCallbacks.map((callbackWithId) => callbackWithId.id);
    if (existingCallbackIds && existingCallbackIds.length > 0) {
      // every new callback gets a new id in increasing manner
      const highestId = existingCallbackIds.sort((a, b) => b - a)[0];
      newCallbackId = highestId + 1;
    }

    existingCallbacks.push({ id: newCallbackId, callback });

    window.__WEAVE_ON_BEFORE_UNLOAD_CALLBACKS__ = existingCallbacks;

    const unlisten = () => {
      const allCallbacks = window.__WEAVE_ON_BEFORE_UNLOAD_CALLBACKS__ || [];
      window.__WEAVE_ON_BEFORE_UNLOAD_CALLBACKS__ = allCallbacks.filter(
        (callbackWithId) => callbackWithId.id !== newCallbackId,
      );
    };

    // We return an unlistener function which removes the callback from the list of callbacks
    return unlisten;
  },

  openAppletMain: async (appletHash: EntryHash): Promise<void> =>
    postMessage({
      type: 'open-view',
      request: {
        type: 'applet-main',
        appletHash,
      },
    }),

  openAppletBlock: async (appletHash, block: string, context: any): Promise<void> =>
    postMessage({
      type: 'open-view',
      request: {
        type: 'applet-block',
        appletHash,
        block,
        context,
      },
    }),

  openCrossAppletMain: (appletBundleId: ActionHash): Promise<void> =>
    postMessage({
      type: 'open-view',
      request: {
        type: 'cross-applet-main',
        appletBundleId,
      },
    }),

  openCrossAppletBlock: (appletBundleId: ActionHash, block: string, context: any): Promise<void> =>
    postMessage({
      type: 'open-view',
      request: {
        type: 'cross-applet-block',
        appletBundleId,
        block,
        context,
      },
    }),

  openAsset: (wal: WAL, mode?: OpenAssetMode): Promise<void> =>
    postMessage({
      type: 'open-view',
      request: {
        type: 'asset',
        wal,
        mode,
      },
    }),

  groupProfile: (groupHash) =>
    postMessage({
      type: 'get-group-profile',
      groupHash,
    }),

  appletInfo: (appletHash) =>
    postMessage({
      type: 'get-applet-info',
      appletHash,
    }),

  notifyFrame: (notifications: Array<FrameNotification>) =>
    postMessage({
      type: 'notify-frame',
      notifications,
    }),

  userSelectScreen: () =>
    postMessage({
      type: 'user-select-screen',
    }),

  requestClose: () =>
    postMessage({
      type: 'request-close',
    }),

  myGroupPermissionType: () =>
    postMessage({
      type: 'my-group-permission-type',
    }),

  appletParticipants: () =>
    postMessage({
      type: 'applet-participants',
    }),

  sendRemoteSignal: (payload: Uint8Array) =>
    postMessage({
      type: 'send-remote-signal',
      payload,
    }),

  onRemoteSignal: (callback: (payload: Uint8Array) => any) => {
    const listener = (e: CustomEvent<Uint8Array>) => callback(e.detail);
    window.addEventListener('remote-signal-received', listener);
    return () => window.removeEventListener('remote-signal-received', listener);
  },
};

(async () => {
  window.__WEAVE_APPLET_HASH__ = readAppletHash();
  window.__WEAVE_APPLET_ID__ = readAppletId();
  window.__WEAVE_API__ = weaveApi;
  window.__WEAVE_APPLET_SERVICES__ = new AppletServices();

  // message handler for ParentToApplet messages
  // This one is registered early here for any type of iframe
  // to be able to respond also in case of page refreshes in short time
  // intervals. Otherwise the message handler may not be registered in time
  // when the on-before-unload message is sent to the iframe and Moss
  // is waiting for a response and will never get one.
  window.addEventListener('message', async (m: MessageEvent<any>) => {
    try {
      const result = await handleEventMessage(m.data);
      // Only send result succcess if truthy, indicating that the message was
      // actually handled, otherwise the `handleMessage` message handler further
      // below will be ignored
      if (result) m.ports[0].postMessage({ type: 'success', result });
    } catch (e) {
      console.error('Failed to handle postMessage\nError:', e, '\nMessage: ', m);
      m.ports[0]?.postMessage({ type: 'error', error: (e as any).message });
    }
  });

  const [_, view] = await Promise.all([fetchLocalStorage(), getRenderView()]);

  if (!view) {
    throw new Error('RenderView undefined.');
  }

  const crossApplet = view ? view.type === 'cross-group-view' : false;

  const iframeConfig: IframeConfig = await postMessage({
    type: 'get-iframe-config',
    crossApplet,
  });

  if (iframeConfig.type === 'not-installed') {
    renderNotInstalled(iframeConfig.appletName);
    return;
  }

  window.__WEAVE_PROTOCOL_VERSION__ = iframeConfig.weaveProtocolVersion;
  window.__MOSS_VERSION__ = iframeConfig.mossVersion;

  // add eventlistener for clipboard
  window.addEventListener('keydown', async (zEvent) => {
    if (zEvent.altKey && zEvent.key === 's') {
      // case sensitive
      await postMessage({ type: 'toggle-pocket' });
    }
  });

  if (view.type === 'applet-view') {
    if (iframeConfig.type !== 'applet') throw new Error('Bad iframe config');

    const [profilesClient, appletClient] = await Promise.all([
      setupProfilesClient(
        iframeConfig.appPort,
        iframeConfig.profilesLocation.authenticationToken,
        iframeConfig.profilesLocation.profilesRoleName,
      ),
      setupAppletClient(iframeConfig.appPort, iframeConfig.authenticationToken),
    ]);

    const appletHash = window.__WEAVE_APPLET_HASH__;

    // message handler for ParentToApplet messages
    window.addEventListener('message', async (m: MessageEvent<any>) => {
      try {
        const result = await handleMessage(appletClient, appletHash, m.data);
        m.ports[0].postMessage({ type: 'success', result });
      } catch (e) {
        console.error(
          'Failed to send postMessage to applet ',
          encodeHashToBase64(appletHash),
          '.\nError:',
          e,
          '\nMessage: ',
          m,
        );
        m.ports[0]?.postMessage({ type: 'error', error: (e as any).message });
      }
    });

    const peerStatusStore: ReadonlyPeerStatusStore = readable<Record<AgentPubKeyB64, PeerStatus>>(
      {},
      (set) => {
        window.addEventListener('peer-status-update', (e: CustomEvent<PeerStatusUpdate>) => {
          set(e.detail);
        });
      },
    );

    window.__WEAVE_RENDER_INFO__ = {
      type: 'applet-view',
      view: view.view,
      appletClient,
      profilesClient,
      peerStatusStore,
      appletHash,
      groupProfiles: iframeConfig.groupProfiles,
    };
  } else if (view.type === 'cross-group-view') {
    const applets: EntryHashMap<{
      appletClient: AppClient;
      profilesClient: ProfilesClient;
    }> = new HoloHashMap();

    if (iframeConfig.type !== 'cross-applet') throw new Error('Bad iframe config');

    await Promise.all(
      Object.entries(iframeConfig.applets).map(
        async ([appletId, [token, { authenticationToken, profilesRoleName }]]) => {
          const [appletClient, profilesClient] = await Promise.all([
            setupAppletClient(iframeConfig.appPort, token),
            setupProfilesClient(iframeConfig.appPort, authenticationToken, profilesRoleName),
          ]);
          applets.set(decodeHashFromBase64(appletId), {
            appletClient,
            profilesClient,
          });
        },
      ),
    );

    window.__WEAVE_RENDER_INFO__ = {
      type: 'cross-group-view',
      view: view.view,
      applets,
    };
  } else {
    throw new Error('Bad RenderView type.');
  }
  window.addEventListener('weave-client-connected', async () => {
    // Once the WeaveClient of the applet has connected, we can update stuff from the AppletServices
    let creatables: Record<CreatableName, CreatableType> = {};
    creatables = window.__WEAVE_APPLET_SERVICES__.creatables;
    // validate that it
    if (!creatables) {
      console.warn(
        `Creatables undefined. The AppletServices passed to the WeaveClient may contain an invalid 'creatables' property.`,
      );
      creatables = {};
    }

    await postMessage({
      type: 'update-creatable-types',
      value: creatables,
    });
  });
  window.dispatchEvent(new CustomEvent('applet-iframe-ready'));
})();

async function fetchLocalStorage() {
  // override localStorage methods and fetch localStorage for this applet from main window
  overrideLocalStorage();
  const appletLocalStorage: Record<string, string> = await postMessage({
    type: 'get-localStorage',
  });
  Object.keys(appletLocalStorage).forEach((key) =>
    window.localStorage.setItem(key, appletLocalStorage[key]),
  );
}

const handleEventMessage = async (message: ParentToAppletMessage) => {
  switch (message.type) {
    case 'on-before-unload':
      const allCallbacks = window.__WEAVE_ON_BEFORE_UNLOAD_CALLBACKS__ || [];
      await Promise.all(
        allCallbacks.map(async (callbackWithId) => await callbackWithId.callback()),
      );
      // return 1 to indicate that message was handled
      return 1;
    default:
      // return 0 to indicate that message was not handled
      return 0;
  }
};

const handleMessage = async (
  appletClient: AppClient,
  appletHash: AppletHash,
  message: ParentToAppletMessage,
) => {
  switch (message.type) {
    case 'get-applet-asset-info':
      return window.__WEAVE_APPLET_SERVICES__.getAssetInfo(
        appletClient,
        message.wal,
        message.recordInfo,
      );
    case 'get-block-types':
      return window.__WEAVE_APPLET_SERVICES__.blockTypes;
    case 'search':
      return window.__WEAVE_APPLET_SERVICES__.search(
        appletClient,
        appletHash,
        window.__WEAVE_API__,
        message.filter,
      );
    case 'peer-status-update':
      window.dispatchEvent(
        new CustomEvent('peer-status-update', {
          detail: message.payload,
        }),
      );
      break;
    case 'asset-store-update':
      window.dispatchEvent(
        new CustomEvent('asset-store-update', {
          detail: message,
        }),
      );
      break;
    case 'remote-signal-received': {
      window.dispatchEvent(
        new CustomEvent('remote-signal-received', {
          detail: message.payload,
        }),
      );
    }
    case 'on-before-unload': {
      // This case is handled in handleEventMessage
      return;
    }
    default:
      throw new Error(
        `Unknown ParentToAppletMessage type: '${(message as any).type}'. Message: ${message}`,
      );
  }
};

async function postMessage(request: AppletToParentRequest): Promise<any> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();

    const message: AppletToParentMessage = {
      request,
      appletHash: window.__WEAVE_APPLET_HASH__,
    };

    // eslint-disable-next-line no-restricted-globals
    try {
      top!.postMessage(message, '*', [channel.port2]);
    } catch (e: any) {
      // let couldNotBeClonedError = false;
      if (e.toString) {
        // couldNotBeClonedError = e.toString().includes('could not be cloned');
        console.error(
          'Invalid iframe message format. Please check the format of the payload of your request. Your request:',
          request,
          '\n\nError:\n',
          e,
        );
      } else {
        console.error('Failed to send postMessage to Moss: ', e);
      }
    }

    channel.port1.onmessage = (m) => {
      if (m.data.type === 'success') {
        resolve(m.data.result);
      } else if (m.data.type === 'error') {
        reject(m.data.error);
      }
    };
  });
}

async function setupAppClient(appPort: number, token: AppAuthenticationToken) {
  const appletClient = await AppWebsocket.connect({
    url: new URL(`ws://127.0.0.1:${appPort}`),
    token,
    callZomeTransform: {
      input: async (request) => {
        if ('signature' in request) return request;
        return signZomeCall(request);
      },
      output: (o) => decode(o as any),
    },
  });

  return appletClient;
}

async function setupAppletClient(
  appPort: number,
  token: AppAuthenticationToken,
): Promise<AppClient> {
  return setupAppClient(appPort, token);
}

async function setupProfilesClient(
  appPort: number,
  token: AppAuthenticationToken,
  roleName: string,
) {
  const client = await setupAppClient(appPort, token);

  return new ProfilesClient(client, roleName);
}

async function signZomeCall(request: CallZomeRequest): Promise<CallZomeRequestSigned> {
  return postMessage({ type: 'sign-zome-call', request });
}

function readAppletHash(): EntryHash {
  if (window.origin.startsWith('applet://')) {
    const urlWithoutProtocol = window.origin.split('://')[1].split('/')[0];
    const lowercaseB64IdWithPercent = urlWithoutProtocol.split('?')[0].split('.')[0];
    const lowercaseB64Id = lowercaseB64IdWithPercent.replace(/%24/g, '$');
    return decodeHashFromBase64(toOriginalCaseB64(lowercaseB64Id));
  }
  // In dev mode, the applet hash will be appended at the end
  const lowercaseB64IdWithPercent = window.location.href.split('#')[1];
  const lowercaseB64Id = lowercaseB64IdWithPercent.replace(/%24/g, '$');
  return decodeHashFromBase64(toOriginalCaseB64(lowercaseB64Id));
}

function readAppletId(): AppletId {
  if (window.origin.startsWith('applet://')) {
    const urlWithoutProtocol = window.origin.split('://')[1].split('/')[0];
    const lowercaseB64IdWithPercent = urlWithoutProtocol.split('?')[0].split('.')[0];
    const lowercaseB64Id = lowercaseB64IdWithPercent.replace(/%24/g, '$');
    return toOriginalCaseB64(lowercaseB64Id);
  }
  // In dev mode, the applet hash will be appended at the end
  const lowercaseB64IdWithPercent = window.location.href.split('#')[1];
  const lowercaseB64Id = lowercaseB64IdWithPercent.replace(/%24/g, '$');
  return toOriginalCaseB64(lowercaseB64Id);
}

async function getRenderView(): Promise<RenderView | undefined> {
  if (window.location.search.length === 0) return undefined;
  const queryString = window.location.search.slice(1);
  return queryStringToRenderView(queryString);
}

async function queryStringToRenderView(s: string): Promise<RenderView> {
  const args = s.split('&');

  const view = args[0].split('=')[1] as 'applet-view' | 'cross-group-view';
  let viewType: string | undefined;
  let block: string | undefined;
  let hrl: Hrl | undefined;
  let context: any | undefined;
  let creatableName: string | undefined;
  let dialogId: string | undefined;

  if (args[1]) {
    viewType = args[1].split('=')[1];
  }

  if (args[2] && args[2].split('=')[0] === 'block') {
    block = args[2].split('=')[1];
  }
  if (args[2] && args[2].split('=')[0] === 'hrl') {
    hrl = parseHrl(args[2].split('=')[1]);
  }
  if (args[3] && args[3].split('=')[0] === 'context') {
    context = decode(toUint8Array(args[3].split('=')[1]));
  }
  if (args[2] && args[2].split('=')[0] === 'creatable') {
    creatableName = args[2].split('=')[1];
    if (args[3] && args[3].split('=')[0] === 'id') {
      dialogId = args[3].split('=')[1];
    }
  }

  switch (viewType) {
    case undefined:
      throw new Error('view is undefined');
    case 'main':
      if (view !== 'applet-view' && view !== 'cross-group-view') {
        throw new Error(`invalid query string: ${s}.`);
      }
      return {
        type: view,
        view: {
          type: 'main',
        },
      };
    case 'block':
      if (view !== 'applet-view' && view !== 'cross-group-view') {
        throw new Error(`invalid query string: ${s}.`);
      }
      if (!block) throw new Error(`Invalid query string: ${s}. Missing block name.`);
      return {
        type: view,
        view: {
          type: 'block',
          block,
          context,
        },
      };
    case 'asset':
      if (!hrl) throw new Error(`Invalid query string: ${s}. Missing hrl parameter.`);
      if (view !== 'applet-view') throw new Error(`Invalid query string: ${s}.`);
      if (hrl[1].toString() === NULL_HASH.toString()) {
        return {
          type: view,
          view: {
            type: 'asset',
            wal: { hrl, context },
          },
        };
      }
      const recordInfo: RecordInfo = await postMessage({
        type: 'get-record-info',
        hrl,
      });
      return {
        type: view,
        view: {
          type: 'asset',
          wal: { hrl, context },
          recordInfo: {
            roleName: recordInfo.roleName,
            integrityZomeName: recordInfo.integrityZomeName,
            entryType: recordInfo.entryType,
          },
        },
      };
    case 'creatable':
      if (!creatableName)
        throw new Error(`Invalid query string: ${s}. Missing creatable parameter.`);
      if (!dialogId) throw new Error(`Invalid query string: ${s}. Missing parameter 'id'.`);
      if (view !== 'applet-view') throw new Error(`Invalid query string: ${s}.`);
      return {
        type: view,
        view: {
          type: 'creatable',
          name: creatableName,
          resolve: (wal: WAL) =>
            postMessage({
              type: 'creatable-result',
              result: { type: 'success', wal },
              dialogId: dialogId!,
            }),
          reject: (error: any) =>
            postMessage({
              type: 'creatable-result',
              result: { type: 'error', error },
              dialogId: dialogId!,
            }),
          cancel: () =>
            postMessage({
              type: 'creatable-result',
              result: { type: 'cancel' },
              dialogId: dialogId!,
            }),
        },
      };

    default:
      throw new Error(`Invalid query string: ${s}`);
  }
}

function overrideLocalStorage(): void {
  const _setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = async function (key, value) {
    if (this === window.localStorage) {
      setTimeout(
        async () =>
          postMessage({
            type: 'localStorage.setItem',
            key,
            value,
          }),
        100,
      );
    }
    _setItem.apply(this, [key, value]);
  };

  const _removeItem = Storage.prototype.removeItem;
  Storage.prototype.removeItem = async function (key): Promise<void> {
    if (this === window.localStorage) {
      setTimeout(
        async () =>
          postMessage({
            type: 'localStorage.removeItem',
            key,
          }),
        100,
      );
    }
    _removeItem.apply(this, [key]);
  };

  const _clear = Storage.prototype.clear;
  Storage.prototype.clear = async function (): Promise<void> {
    if (this === window.localStorage) {
      setTimeout(
        async () =>
          postMessage({
            type: 'localStorage.clear',
          }),
        100,
      );
    }
    _clear.apply(this, []);
  };
}

function renderNotInstalled(appletName: string) {
  document.body.innerHTML = `<div
    style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center"
  >
    <span>You don't have the applet ${appletName} installed.</span>
    <span>Install it from the group's home, and refresh this view.</span>
  </div>`;
}
