import {
  type AppClient,
  type AgentPubKeyB64,
  type RoleName,
  encodeHashToBase64,
  type AgentPubKey,
  AppAuthenticationToken,
  InstalledAppId,
  AppCallZomeRequest,
} from '@holochain/client';
import TimeAgo from 'javascript-time-ago';
import type { ProfilesStore } from '@holochain-open-dev/profiles';
import { type Writable, writable, get, type Readable, readable } from '@holochain-open-dev/stores';
import { HoloHashMap } from '@holochain-open-dev/utils/dist/holo-hash-map';
import { type Message, Stream, type Payload } from './stream';
import { derived } from 'svelte/store';

export const time = readable(Date.now(), function start(set) {
  const interval = setInterval(() => {
    set(Date.now());
  }, 1000);

  return function stop() {
    clearInterval(interval);
  };
});

const ZOME_NAME = 'foyer';

export class FoyerClient {
  constructor(
    public client: AppClient,
    public authenticationToken: AppAuthenticationToken,
    public roleName,
    public zomeName = ZOME_NAME,
  ) {}

  get myPubKey(): AgentPubKey {
    return this.client.myPubKey;
  }

  get installedAppId(): InstalledAppId {
    return this.client.installedAppId;
  }

  async sendMessage(streamId: string, payload: Payload, agents: AgentPubKey[]) {
    await this.callZome('send_message', {
      streamId,
      content: JSON.stringify(payload),
      agents,
    });
  }
  private callZome(fn_name: string, payload: any) {
    const req: AppCallZomeRequest = {
      role_name: this.roleName,
      zome_name: this.zomeName,
      fn_name,
      payload,
    };
    return this.client.callZome(req);
  }
}

export class FoyerStore {
  myPubKeyB64: AgentPubKeyB64;
  timeAgo = new TimeAgo('en-US');
  updating = false;
  client: FoyerClient;
  streams: Writable<{ [key: string]: Stream }> = writable({});
  lastSeen: Writable<HoloHashMap<AgentPubKey, number>> = writable(new HoloHashMap());
  lastActivity: Writable<{ [key: string]: number }> = writable({});
  expectations: HoloHashMap<AgentPubKey, Array<number>> = new HoloHashMap();
  private _activeAgents: HoloHashMap<AgentPubKey, boolean> = new HoloHashMap();
  agentActive: Readable<HoloHashMap<AgentPubKey, boolean>> = derived(time, ($time) => {
    Array.from(get(this.lastSeen).entries()).forEach(([agent, lastSeen]) =>
      this._activeAgents.set(agent, $time - lastSeen < 31000),
    );
    return this._activeAgents;
  });

  async sendMessage(streamId: string, payload: Payload, agents: AgentPubKey[]) {
    console.log(
      'Sending Message to',
      agents.map((agent) => encodeHashToBase64(agent)),
    );
    this.addMessageToStream(streamId, {
      payload,
      from: this.client.myPubKey,
      received: Date.now(),
    });
    for (const agent of agents) {
      let messageList: Array<number> = this.expectations.get(agent);
      if (!messageList) {
        messageList = [];
      }
      messageList.push(payload.created);
      this.expectations.set(agent, messageList);
    }
    await this.client.sendMessage(streamId, payload, agents);
  }

  newStream(streamId: string): Stream {
    const stream = new Stream(streamId);
    this.streams.update((s) => {
      s[streamId] = stream;
      return s;
    });
    return stream;
  }
  zapStream(streamId: string) {
    this.streams.update((s) => {
      delete s[streamId];
      return s;
    });
  }

  async addMessageToStream(streamId: string, message: Message) {
    if (message.payload.type != 'Ping') {
      this.lastActivity.update((l) => {
        l[streamId] = message.received;
        return l;
      });
    }
    this.lastSeen.update((l) => {
      l.set(message.from, message.received);
      return l;
    });
    let stream = get(this.streams)[streamId];
    if (!stream) {
      stream = this.newStream(streamId);
    }

    stream.addMessage(message);
    if (message.payload.type == 'Msg') {
      //   if (isWeContext()) {
      //     this.weaveClient.notifyFrame([
      //       {
      //         title: `message from ${encodeHashToBase64(message.from)}`,
      //         body: message.payload.text,
      //         notification_type: 'message',
      //         icon_src: undefined,
      //         urgency: 'high',
      //         timestamp: message.payload.created,
      //       },
      //     ]);
      //   }
      if (encodeHashToBase64(message.from) != this.myPubKeyB64) {
        await this.client.sendMessage(streamId, { type: 'Ack', created: message.payload.created }, [
          message.from,
        ]);
      }
    }
  }

  constructor(
    public profilesStore: ProfilesStore,
    protected clientIn: AppClient,
    public authenticationToken: AppAuthenticationToken,
    protected roleName: RoleName,
    protected zomeName: string = ZOME_NAME,
  ) {
    this.client = new FoyerClient(clientIn, this.authenticationToken, this.roleName, this.zomeName);

    this.newStream('_all');

    this.client.client.on('signal', async (sig) => {
      const signal = sig.payload;
      // @ts-ignore
      if (signal.type == 'Message') {
        // @ts-ignore
        const from: AgentPubKey = signal.from;
        // @ts-ignore
        const streamId = signal.stream_id;
        // @ts-ignore
        const payload: Payload = JSON.parse(signal.content);
        const message: Message = {
          payload,
          from,
          received: Date.now(),
        };
        this.addMessageToStream(streamId, message);
        let messageList = this.expectations.get(message.from);
        if (messageList) {
          if (payload.type == 'Ack') {
            const idx = messageList.findIndex((created) => created == payload.created);
            if (idx >= 0) {
              messageList.splice(idx, 1);
              this.expectations.set(message.from, messageList);
            }
          }
          // we just received a message from someone who we are expecting
          // to have acked something but they haven't so we retry to send the message
          if (messageList.length > 0) {
            const streams = Object.values(get(this.streams));
            for (const msgId of messageList) {
              for (const stream of streams) {
                const msg = stream.findMessage(msgId);
                if (msg) {
                  console.log('Resending', msg);
                  await this.client.sendMessage(stream.id, msg.payload, [message.from]);
                }
              }
            }
          }
        }
      }
    });

    this.myPubKeyB64 = encodeHashToBase64(this.client.myPubKey);
  }
}
