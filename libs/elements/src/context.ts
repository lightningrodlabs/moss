import { createContext } from '@lit/context';
import { WeaveClient, WeaveServices } from '@theweave/api';

export const weaveClientContext = createContext<WeaveClient | WeaveServices>('we_client');
