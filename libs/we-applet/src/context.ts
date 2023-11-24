import { createContext } from "@lit-labs/context";
import { WeClient, WeServices } from "./api";

export const weClientContext = createContext<WeClient | WeServices>("we_client");
