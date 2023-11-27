import { createContext } from '@lit-labs/context';
import { CustomViewsStore } from './custom-views-store.js';

export const customViewsStoreContext = createContext<CustomViewsStore>(
  'hc_zome_custom_views/store',
);
