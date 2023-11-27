import { createContext } from '@lit-labs/context';
import { WeStore } from './we-store.js';

export const weStoreContext = createContext<WeStore>('hc_zome_we/we_store_context');
