import { createContext } from '@lit/context';
import { AppOpenViews } from './types.js';

export const openViewsContext = createContext<AppOpenViews>('openViews');
