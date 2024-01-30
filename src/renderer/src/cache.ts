// /**
//  * Cache for We
//  */
// export class WeCache {
//   private store: KeyValueStore;

//   constructor(store: KeyValueStore) {
//     this.store = store;
//   }
// }

// export interface SubStore<T, U, V> {
//   value: (id: V) => T;
//   set: (value: U, id: V) => void;
// }

// export class SessionStorageStore implements KeyValueStore {
//   getItem = <T>(key: string): T | undefined => {
//     return getSessionStorageItem<T>(key);
//   };

//   setItem = <T>(key: string, value: T) => {
//     setSessionStorageItem(key, value);
//   };

//   removeItem = (key: string) => {
//     window.sessionStorage.removeItem(key);
//   };

//   clear = () => {
//     window.sessionStorage.clear();
//   };
// }

// export interface KeyValueStore {
//   getItem: <T>(key: string) => T | undefined;
//   setItem: <T>(key: string, value: T) => void;
//   clear: () => void;
//   removeItem: (key: string) => any;
// }

// export function getSessionStorageItem<T>(key: string): T | undefined {
//   const item: string | null = window.sessionStorage.getItem(key);
//   return item ? JSON.parse(item) : undefined;
// }

// export function setSessionStorageItem<T>(key: string, value: T): void {
//   window.sessionStorage.setItem(key, JSON.stringify(value));
// }
