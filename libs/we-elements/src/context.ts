import { createContext } from '@lit/context';
import { WeClient, WeServices } from '@lightningrodlabs/we-applet';

export const weClientContext = createContext<WeClient | WeServices>('we_client');
