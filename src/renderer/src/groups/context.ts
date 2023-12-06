import { createContext } from '@lit/context';
import { GroupStore } from './group-store.js';

export const groupStoreContext = createContext<GroupStore>('hc_zome_we/group_context');
