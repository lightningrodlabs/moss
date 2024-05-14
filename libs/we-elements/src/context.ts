import { createContext } from '@lit/context';
import { WeaveClient, WeaveServices } from '@lightningrodlabs/we-applet';

export const weaveClientContext = createContext<WeaveClient | WeaveServices>('we_client');
