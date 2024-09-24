import { AgentPubKeyB64 } from '@holochain/client';

export type PartialModifiers = {
  networkSeed: string;
  progenitor: AgentPubKeyB64 | null;
};
