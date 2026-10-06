import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import browser from "webextension-polyfill";
import { STORAGE_KEYS } from "@/types";
import { persistLocalProfile, switchAccountData } from "./localDatabase";

let storage: Record<string, unknown>;
beforeEach(() => {
  storage = {};
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, action: () => unknown) => action() } });
  vi.spyOn(browser.storage.local, "get").mockImplementation(async keys => {
    const names = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(storage);
    return Object.fromEntries(names.map(key => [key, structuredClone(storage[key])]));
  });
  vi.spyOn(browser.storage.local, "set").mockImplementation(async values => { Object.assign(storage, structuredClone(values)); });
  vi.spyOn(browser.storage.local, "remove").mockImplementation(async keys => {
    for (const key of typeof keys === "string" ? [keys] : keys) delete storage[key];
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const switchTo = async (id: string | null) => {
  await switchAccountData(id);
  if (id) storage[STORAGE_KEYS.AUTH_SESSION] = { user: { id } };
  else delete storage[STORAGE_KEYS.AUTH_SESSION];
};

const records = async () => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("mindease-local", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const transaction = database.transaction("profiles");
      const request = transaction.objectStore("profiles").getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
};

describe("local learner database", () => {
  it("restores independent device and account state instead of leaking the last learner", async () => {
    storage[STORAGE_KEYS.PROFILE] = { userId: "device" };
    await persistLocalProfile();
    const machineId = storage.mindease_installation_id;
    await switchTo("account-a");
    storage[STORAGE_KEYS.PROFILE] = { userId: "learner-a" };
    storage[STORAGE_KEYS.SESSION_HISTORY] = [{ sessionId: "private-a" }];
    await persistLocalProfile();
    await switchTo("account-b");
    expect(storage[STORAGE_KEYS.PROFILE]).toBeUndefined();
    expect(storage[STORAGE_KEYS.SESSION_HISTORY]).toBeUndefined();
    storage[STORAGE_KEYS.PROFILE] = { userId: "learner-b" };
    await switchTo("account-a");
    expect(storage[STORAGE_KEYS.PROFILE]).toEqual({ userId: "learner-a" });
    expect(storage[STORAGE_KEYS.SESSION_HISTORY]).toEqual([{ sessionId: "private-a" }]);
    await switchTo(null);
    expect(storage[STORAGE_KEYS.PROFILE]).toEqual({ userId: "device" });
    expect(storage.mindease_installation_id).toBe(machineId);
    const saved = await records();
    expect(saved.find(record => record.installationId === machineId)?.profile).toEqual({ userId: "device" });
    expect(saved.find(record => record.installationId === "account:account-a")?.profile).toEqual({ userId: "learner-a" });
  });

  it.each([{ state: "active" }, { state: "ended", archivePending: true }])("refuses account changes before the study session is durable: %j", async workspace => {
    storage[STORAGE_KEYS.WORKSPACE] = workspace;
    storage[STORAGE_KEYS.PROFILE] = { userId: "device" };
    await expect(switchTo("account-a")).rejects.toThrow(/End the current study session/);
    expect(storage[STORAGE_KEYS.PROFILE]).toEqual({ userId: "device" });
    expect(storage[STORAGE_KEYS.AUTH_SESSION]).toBeUndefined();
  });
});
