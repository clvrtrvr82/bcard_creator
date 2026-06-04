import { BrandConfig } from './types';

const DB_NAME = 'theme-vault-designer';
const DB_VERSION = 1;
const STORE_NAME = 'app-state';
const LAYOUTS_KEY = 'brand-configs';

const hasIndexedDb = typeof indexedDB !== 'undefined';

const openDatabase = async (): Promise<IDBDatabase | null> => {
  if (!hasIndexedDb) return null;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open IndexedDB.'));
  });
};

export const loadPersistedLayouts = async (): Promise<Record<string, BrandConfig> | null> => {
  const database = await openDatabase();
  if (!database) return null;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(LAYOUTS_KEY);

    request.onsuccess = () => {
      resolve((request.result as Record<string, BrandConfig> | undefined) ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error('Unable to load persisted layouts.'));
  });
};

export const persistLayouts = async (configs: Record<string, BrandConfig>): Promise<void> => {
  const database = await openDatabase();
  if (!database) return;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(configs, LAYOUTS_KEY);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Unable to persist layouts.'));
  });
};