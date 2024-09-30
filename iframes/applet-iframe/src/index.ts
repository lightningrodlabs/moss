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
  OpenWalMode,
  CreatableName,
  CreatableType,
  RecordInfo,
  NULL_HASH,
  PeerStatusUpdate,
  PeerStatus,
  ReadonlyPeerStatusStore,
  AppletToParentRequest,
  AppletId,
} from '@theweave/api';
import { readable } from '@holochain-open-dev/stores';
import { toOriginalCaseB64 } from '@theweave/utils';

declare global {
  interface Window {
    __WEAVE_API__: WeaveServices;
    __WEAVE_APPLET_SERVICES__: AppletServices;
    __WEAVE_RENDER_INFO__: RenderInfo;
    __WEAVE_APPLET_HASH__: AppletHash;
    __WEAVE_APPLET_ID__: AppletId;
    __WEAVE_PROTOCOL_VERSION__: string;
    __MOSS_VERSION__: string;
  }

  interface WindowEventMap {
    'peer-status-update': CustomEvent<PeerStatusUpdate>;
  }
}

const weaveApi: WeaveServices = {
  mossVersion: () => {
    return window.__MOSS_VERSION__;
  },
  onPeerStatusUpdate: (callback: (payload: PeerStatusUpdate) => any) => {
    const listener = (e: CustomEvent<PeerStatusUpdate>) => callback(e.detail);
    window.addEventListener('peer-status-update', listener);
    return () => window.removeEventListener('peer-status-update', listener);
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

  openWal: (wal: WAL, mode?: OpenWalMode): Promise<void> =>
    postMessage({
      type: 'open-view',
      request: {
        type: 'wal',
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

  assetInfo: (wal: WAL) =>
    postMessage({
      type: 'get-global-asset-info',
      wal,
    }),

  walToPocket: (wal: WAL) =>
    postMessage({
      type: 'wal-to-pocket',
      wal,
    }),

  dragWal: (wal: WAL) =>
    postMessage({
      type: 'drag-wal',
      wal,
    }),

  userSelectWal: () =>
    postMessage({
      type: 'user-select-wal',
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

  requestBind: (srcWal: WAL, dstWal: WAL) =>
    postMessage({
      type: 'request-bind',
      srcWal,
      dstWal,
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
};

(async () => {
  window.__WEAVE_APPLET_HASH__ = readAppletHash();
  window.__WEAVE_APPLET_ID__ = readAppletId();
  window.__WEAVE_API__ = weaveApi;
  window.__WEAVE_APPLET_SERVICES__ = new AppletServices();

  const [_, view] = await Promise.all([fetchLocalStorage(), getRenderView()]);

  if (!view) {
    throw new Error('RenderView undefined.');
  }

  const crossApplet = view ? view.type === 'cross-applet-view' : false;

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

    const appletHash = window.__WEAVE_APPLET_HASH__;

    // message handler for ParentToApplet messages - Only added for applet main-view
    window.addEventListener('message', async (m: MessageEvent<any>) => {
      try {
        const result = await handleMessage(appletClient, appletHash, m.data);
        m.ports[0].postMessage({ type: 'success', result });
      } catch (e) {
        console.error(
          'Failed to send postMessage to applet ',
          encodeHashToBase64(appletHash),
          ': ',
          e,
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

    const [profilesClient, appletClient] = await Promise.all([
      setupProfilesClient(
        iframeConfig.appPort,
        iframeConfig.profilesLocation.authenticationToken,
        iframeConfig.profilesLocation.profilesRoleName,
      ),
      setupAppletClient(iframeConfig.appPort, iframeConfig.authenticationToken),
    ]);

    window.__WEAVE_RENDER_INFO__ = {
      type: 'applet-view',
      view: view.view,
      appletClient,
      profilesClient,
      peerStatusStore,
      appletHash,
      groupProfiles: iframeConfig.groupProfiles,
    };
  } else if (view.type === 'cross-applet-view') {
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
      type: 'cross-applet-view',
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
    case 'bind-asset':
      return window.__WEAVE_APPLET_SERVICES__.bindAsset(
        appletClient,
        message.srcWal,
        message.dstWal,
        message.dstRecordInfo,
      );
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
    default:
      throw new Error(`Unknown ParentToAppletMessage: '${(message as any).type}'`);
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
      let couldNotBeClonedError = false;
      if (e.toString) {
        couldNotBeClonedError = e.toString().includes('could not be cloned');
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

  const view = args[0].split('=')[1] as 'applet-view' | 'cross-applet-view';
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
      if (view !== 'applet-view' && view !== 'cross-applet-view') {
        throw new Error(`invalid query string: ${s}.`);
      }
      return {
        type: view,
        view: {
          type: 'main',
        },
      };
    case 'block':
      if (view !== 'applet-view' && view !== 'cross-applet-view') {
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
          reject: (reason: any) =>
            postMessage({
              type: 'creatable-result',
              result: { type: 'error', reason },
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
