import type { Board } from "./types";
import { tileImage } from "./types";
import { recordingFor } from "./recordings";
const CACHE = "connectus-pictures-v2";
const GENERATION = "connectus-offline-generation";
let memoryGeneration = "";
export const ACCOUNT_EVENT = "connectus-account-cleared";
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("connectus", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("boards");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function read(key: string) {
  const db = await openDB();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const r = db.transaction("boards").objectStore("boards").get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
async function write(board: Board | null) {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("boards", "readwrite");
      const store = tx.objectStore("boards");
      // One family may be enrolled on this browser at a time. Its owner remains explicit.
      store.clear();
      if (board) {
        store.put(board, `board:${board.ownerId || "local"}`);
        store.put(board.ownerId || "local", "active");
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function lock<T>(fn: () => Promise<T>) {
  return navigator.locks
    ? navigator.locks.request("connectus-offline", fn)
    : fn();
}
export function offlineGeneration() {
  try {
    return localStorage.getItem(GENERATION) || memoryGeneration;
  } catch {
    return memoryGeneration;
  }
}
export async function loadSavedBoard(owner?: string): Promise<Board | null> {
  const scope = await read("active");
  if (typeof scope === "string") {
    if (owner && owner !== scope) return null;
    return ((await read(`board:${scope}`)) as Board) || null;
  }
  // Read old local-only snapshots, never treat them as a signed-in family's board.
  if (owner && owner !== "local") return null;
  const legacy = (await read("current")) as Board | undefined;
  return legacy && !legacy.ownerId ? legacy : null;
}
export async function clearSavedBoard() {
  memoryGeneration = crypto.randomUUID();
  try {
    localStorage.setItem(GENERATION, memoryGeneration);
  } catch {
    /* Online mode still works without browser storage. */
  }
  window.dispatchEvent(new Event(ACCOUNT_EVENT));
  await lock(async () => {
    const failures: unknown[] = [];
    try {
      await write(null);
    } catch (e) {
      failures.push(e);
    }
    if ("caches" in window)
      for (const key of await caches.keys())
        if (key.startsWith("connectus-pictures-")) {
          try {
            await caches.delete(key);
          } catch (e) {
            failures.push(e);
          }
        }
    try {
      localStorage.removeItem("connectus-preferences");
    } catch {
      /* Optional preferences may be unavailable. */
    }
    if (failures.length)
      throw new Error(
        "Could not remove all saved browser data. Clear this site’s data in browser settings.",
      );
  });
}
export async function cacheBoardAssets(board: Board) {
  const cache = await caches.open(CACHE);
  const urls = new Set([
    ...board.tiles.map(tileImage),
    ...board.tiles
      .map((t) => recordingFor(t.text)?.src)
      .filter((s): s is string => Boolean(s)),
  ]);
  const pending = [...urls];
  for (let i = 0; i < pending.length; i += 6)
    await Promise.all(
      pending.slice(i, i + 6).map(async (url) => {
        if (!(await cache.match(url))) {
          const response = await fetch(url, { cache: "no-store" });
          if (!response.ok)
            throw new Error(
              "Some pictures or recordings have not downloaded yet.",
            );
          await cache.put(url, response);
        }
      }),
    );
  for (const request of await cache.keys())
    if (!urls.has(new URL(request.url).pathname)) await cache.delete(request);
}
export async function prepareOffline(board: Board) {
  const generation = offlineGeneration();
  return lock(async () => {
    if (offlineGeneration() !== generation) return false;
    await write(board);
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator) ||
      !("caches" in window)
    )
      return false;
    const registration = await navigator.serviceWorker.register("/sw.js");
    await registration.update();
    await new Promise<void>((resolve, reject) => {
      const worker =
        registration.installing || registration.waiting || registration.active;
      if (!worker) {
        reject(new Error("Offline setup has not started."));
        return;
      }
      const cleanup = () => {
        clearTimeout(timeout);
        worker.removeEventListener("statechange", check);
      };
      const check = () => {
        if (worker.state === "activated") {
          cleanup();
          resolve();
        } else if (worker.state === "redundant") {
          cleanup();
          reject(new Error("Offline setup failed."));
        }
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Offline setup timed out."));
      }, 20000);
      worker.addEventListener("statechange", check);
      check();
    });
    await cacheBoardAssets(board);
    return offlineGeneration() === generation;
  });
}
