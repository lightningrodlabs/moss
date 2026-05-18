import { createContext } from '@lit/context';
import { DeveloperCollectiveStore } from './developer-collective-store';

export const developerCollectiveStoreContext = createContext<DeveloperCollectiveStore>(
  'hc_zome_we/developer_collective_context',
);
