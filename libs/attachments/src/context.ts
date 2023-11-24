import { createContext } from "@lit-labs/context";
import { AttachmentsStore } from "./attachments-store.js";

export const attachmentsStoreContext =
  createContext<AttachmentsStore>("attachments_store");
