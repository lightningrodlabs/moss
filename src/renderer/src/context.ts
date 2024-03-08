import { createContext } from '@lit/context';
import { MossStore } from './moss-store.js';

export const mossStoreContext = createContext<MossStore>('hc_zome_moss/moss_store_context');
