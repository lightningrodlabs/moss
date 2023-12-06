import { createContext } from '@lit/context';
import { WeClient, WeServices } from './api';

export const weClientContext = createContext<WeClient | WeServices>('we_client');
