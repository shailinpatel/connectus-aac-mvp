import { readFile, writeFile, readdir, copyFile } from "node:fs/promises";
import path from "node:path";

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : path.join(dir, e.name),
      ),
    )
  ).flat();
}
// The home page is a static shell. Board data is fetched separately and saved in IndexedDB.
await copyFile(".next/server/app/index.html", "public/offline.html");
const buildId = (await readFile(".next/BUILD_ID", "utf8")).trim();
const chunks = (await walk(".next/static"))
  .filter((f) => /\.(js|css|woff2)$/.test(f))
  .map((f) => "/" + f.replace(/^\.next\//, "_next/"));
const fonts = (await walk("public/fonts")).map((f) => f.replace(/^public/, ""));
const precache = [
  "/offline.html",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
  ...chunks,
  ...fonts,
];
await writeFile(
  "public/sw.js",
  `
const SHELL = ${JSON.stringify("connectus-shell-" + buildId)};
const PICTURES = 'connectus-pictures-v1';
const PRECACHE = ${JSON.stringify(precache)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Keep the previous shell's assets for any open tabs during a compatible update.
    const shells = (await caches.keys()).filter(key => key.startsWith('connectus-shell-'));
    const previous = shells.filter(key => key !== SHELL).at(-1);
    for (const key of shells) if (key !== SHELL && key !== previous) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(SHELL)).match('/offline.html')));
  } else if (url.pathname.startsWith('/pictograms/') || url.pathname.startsWith('/api/photos/') || url.pathname.startsWith('/audio/tiles/')) {
    event.respondWith((async () => {
      const cache = await caches.open(PICTURES);
      return await cache.match(request) || fetch(request);
    })());
  } else if (PRECACHE.includes(url.pathname) || url.pathname.startsWith('/_next/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      return await cache.match(url.pathname) || await caches.match(request) || fetch(request);
    })());
  }
  // Never cache caregiver sessions or mutation responses.
});
`,
);
console.log(
  `Offline shell generated with ${precache.length} assets (${buildId}).`,
);
