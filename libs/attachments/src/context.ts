import { createContext } from '@lit/context';
import { AttachmentsStore } from './attachments-store.js';

export const attachmentsStoreContext = createContext<AttachmentsStore>('attachments_store');
