import type { CaptureInput } from "./types";

const DB_NAME = "kotoba-no-hokanko";
const STORE = "pending-captures";
const DB_VERSION = 1;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "client_id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transact = async <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = operation(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
};

export const queueCapture = (capture: CaptureInput): Promise<IDBValidKey> =>
  transact("readwrite", (store) => store.put(capture));

export const removeQueuedCapture = (id: string): Promise<undefined> =>
  transact("readwrite", (store) => store.delete(id)) as Promise<undefined>;

export const listQueuedCaptures = async (): Promise<CaptureInput[]> => {
  const result = await transact("readonly", (store) => store.getAll());
  return (result as CaptureInput[]).sort((left, right) =>
    left.captured_at.localeCompare(right.captured_at)
  );
};

export const queuedCount = async (): Promise<number> =>
  transact("readonly", (store) => store.count());
