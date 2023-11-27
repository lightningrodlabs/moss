import { createContext } from '@lit-labs/context';
import { AppOpenViews } from './types.js';

export const openViewsContext = createContext<AppOpenViews>('openViews');
