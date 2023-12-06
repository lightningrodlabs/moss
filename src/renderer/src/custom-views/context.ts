import { createContext } from '@lit/context';
import { CustomViewsStore } from './custom-views-store.js';

export const customViewsStoreContext = createContext<CustomViewsStore>(
  'hc_zome_custom_views/store',
);
