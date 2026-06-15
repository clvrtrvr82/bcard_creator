import { BrandConfig } from './types';

const DB_NAME = 'theme-vault-designer';
const DB_VERSION = 1;
const STORE_NAME = 'app-state';
const LAYOUTS_KEY = 'brand-configs';
const SERVER_LAYOUTS_ENDPOINT = '/api/layouts';
const SERVER_LAYOUTS_UNAVAILABLE_KEY = 'theme-vault-layout-api-unavailable';

const hasIndexedDb = typeof indexedDB !== 'undefined';
const hasSessionStorage = typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';

const isServerLayoutsApiUnavailable = () => {
  if (!hasSessionStorage) return false;

  try {
    return window.sessionStorage.getItem(SERVER_LAYOUTS_UNAVAILABLE_KEY) === '1';
  } catch {
    return false;
  }
};

const markServerLayoutsApiUnavailable = () => {
  if (!hasSessionStorage) return;

  try {
    window.sessionStorage.setItem(SERVER_LAYOUTS_UNAVAILABLE_KEY, '1');
  } catch {
    // Ignore storage errors and keep runtime behavior resilient.
  }
};

const clearServerLayoutsApiUnavailable = () => {
  if (!hasSessionStorage) return;

  try {
    window.sessionStorage.removeItem(SERVER_LAYOUTS_UNAVAILABLE_KEY);
  } catch {
    // Ignore storage errors and keep runtime behavior resilient.
  }
};

const loadServerLayouts = async (): Promise<Record<string, BrandConfig> | null> => {
  if (typeof fetch === 'undefined') return null;
  if (isServerLayoutsApiUnavailable()) return null;

  try {
    const response = await fetch(SERVER_LAYOUTS_ENDPOINT, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.status === 404) {
      markServerLayoutsApiUnavailable();
      return null;
    }

    if (!response.ok) {
      throw new Error(`Unable to load server layouts: ${response.status}`);
    }

    clearServerLayoutsApiUnavailable();

    const payload = await response.json();
    const configs = payload?.brandConfigs;
    if (!configs || typeof configs !== 'object') {
      return null;
    }

    return configs as Record<string, BrandConfig>;
  } catch (error) {
    console.warn('Unable to load layouts from server.', error);
    return null;
  }
};

const persistServerLayouts = async (configs: Record<string, BrandConfig>): Promise<void> => {
  if (typeof fetch === 'undefined') return;
  if (isServerLayoutsApiUnavailable()) return;

  const response = await fetch(SERVER_LAYOUTS_ENDPOINT, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ brandConfigs: configs })
  });

  if (response.status === 404) {
    markServerLayoutsApiUnavailable();
    return;
  }

  if (!response.ok) {
    throw new Error(`Unable to persist server layouts: ${response.status}`);
  }

  clearServerLayoutsApiUnavailable();
};

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
  const serverLayouts = await loadServerLayouts();
  if (serverLayouts) {
    return serverLayouts;
  }

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
  await persistServerLayouts(configs).catch((error) => {
    console.warn('Unable to persist layouts to server.', error);
  });

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