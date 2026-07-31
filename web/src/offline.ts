import type { CaptureInput, ReminderInput } from "./types";

const DB_NAME = "kotoba-no-hokanko";
const CAPTURE_STORE = "pending-captures";
const REMINDER_STORE = "pending-reminders";
const DB_VERSION = 2;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CAPTURE_STORE)) {
        request.result.createObjectStore(CAPTURE_STORE, { keyPath: "client_id" });
      }
      if (!request.result.objectStoreNames.contains(REMINDER_STORE)) {
        request.result.createObjectStore(REMINDER_STORE, { keyPath: "client_id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const transact = async <T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
};

export const queueCapture = (capture: CaptureInput): Promise<IDBValidKey> =>
  transact(CAPTURE_STORE, "readwrite", (store) => store.put(capture));

export const removeQueuedCapture = (id: string): Promise<undefined> =>
  transact(CAPTURE_STORE, "readwrite", (store) => store.delete(id)) as Promise<undefined>;

export const listQueuedCaptures = async (): Promise<CaptureInput[]> => {
  const result = await transact(CAPTURE_STORE, "readonly", (store) => store.getAll());
  return (result as CaptureInput[]).sort((left, right) =>
    left.captured_at.localeCompare(right.captured_at)
  );
};

export const queuedCount = async (): Promise<number> =>
  transact(CAPTURE_STORE, "readonly", (store) => store.count());

export const queueReminder = (reminder: ReminderInput): Promise<IDBValidKey> =>
  transact(REMINDER_STORE, "readwrite", (store) => store.put(reminder));

export const removeQueuedReminder = (id: string): Promise<undefined> =>
  transact(REMINDER_STORE, "readwrite", (store) => store.delete(id)) as Promise<undefined>;

export const listQueuedReminders = async (): Promise<ReminderInput[]> => {
  const result = await transact(REMINDER_STORE, "readonly", (store) => store.getAll());
  return result as ReminderInput[];
};
