import type { Board } from "./types";
import { tileImage } from "./types";
const CACHE = "connectus-pictures-v1";
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("connectus", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("boards");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadSavedBoard(): Promise<Board | null> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction("boards")
        .objectStore("boards")
        .get("current");
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function saveBoard(board: Board) {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("boards", "readwrite");
      tx.objectStore("boards").put(board, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function cachePictures(board: Board) {
  const cache = await caches.open(CACHE);
  const urls = new Set(board.tiles.map(tileImage));
  // Small batches avoid overwhelming slow devices and make readiness reflect actual downloads.
  const pending = [...urls];
  for (let i = 0; i < pending.length; i += 6)
    await Promise.all(
      pending.slice(i, i + 6).map(async (url) => {
        if (!(await cache.match(url))) {
          const response = await fetch(url);
          if (!response.ok)
            throw new Error("Some pictures haven't downloaded yet.");
          await cache.put(url, response);
        }
      }),
    );
  for (const request of await cache.keys())
    if (!urls.has(new URL(request.url).pathname)) await cache.delete(request);
}
export async function prepareOffline(board: Board) {
  await saveBoard(board);
  if (process.env.NODE_ENV !== "production") return false;
  if (!("serviceWorker" in navigator) || !("caches" in window)) return false;
  await navigator.serviceWorker.register("/sw.js");
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Offline setup timed out. Please retry.")),
      20000,
    );
    navigator.serviceWorker.ready.then(
      () => {
        clearTimeout(timeout);
        resolve();
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
  await cachePictures(board);
  return true;
}
