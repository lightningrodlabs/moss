import { HoloHashMap } from '@holochain-open-dev/utils';
import type { AgentPubKey } from '@holochain/client';
import { writable, type Readable, type Writable, derived } from 'svelte/store';

export type Msg = {
  created: number;
  text: string;
};

export type Payload =
  | ({ type: 'Msg' } & Msg)
  | ({ type: 'Ack' } & { created: number })
  | ({ type: 'Ping' } & { created: number });

export type Message = {
  payload: Payload;
  from: AgentPubKey;
  received: number;
};

export class Stream {
  _store = {};
  private store: Writable<Message[]> = writable([]);
  messages: Readable<Message[]>;
  _acks: Writable<Record<number, HoloHashMap<AgentPubKey, boolean>>> = writable({});
  constructor(public id: string) {
    this.messages = derived(this.store, (s) =>
      s.sort((a, b) => a.payload.created - b.payload.created),
    );
  }
  acks() {
    return derived(this._acks, (store) => store);
  }
  addMessage(message: Message) {
    if (message.payload.type == 'Ack') {
      this._acks.update((acks) => {
        let ack = acks[message.payload.created];
        if (!ack) {
          ack = new HoloHashMap();
          acks[message.payload.created] = ack;
        }
        ack.set(message.from, true);
        return acks;
      });
    } else if (message.payload.type == 'Msg') {
      if (!(message.payload.created in this._store)) {
        console.log('Adding Message', message);
        this._store[message.payload.created] = message;
        this.store.update((messages) => {
          messages.push(message);
          return messages;
        });
      }
    }
  }
  findMessage(msgId: number) {
    return this._store[msgId];
  }
}
