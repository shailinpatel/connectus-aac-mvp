# Connectus

A warm, picture-based communication board for people who use augmentative and alternative communication (AAC). Rebuilt from the original compiled HTML MVP as an editable full stack application.

## Run locally

Requires Node.js 22.12+ and npm. No Docker, cloud account, API key, or environment file is needed.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3000**. This runs the production build locally, including its offline support. The server listens only on this computer by default.

For development with live updates:

```sh
npm run dev
```

Full offline page reloads are enabled in the production build, not the development server. Use a separate browser profile for development if you have already installed the production service worker, or unregister it in browser developer tools → Application → Service workers.

## Use the board

- Tap a picture to say its word and add it to the sentence. Use **Speak**, **Undo**, or **Clear** to control the sentence. Tap an individual word in the sentence to remove it.
- Choose a category or Favorites to find words. The original 83 phrases and eight categories are preserved.
- Select **Caregiver mode** and create your own 4–8 digit PIN the first time. There is no default PIN. The PIN protects editing; it is not a family account or access control for viewing the board.
- Use a tile's pencil button to change its phrase, category, picture symbol, custom photo, or favorite status. Add tiles with **Add tile**. Removing a tile requires confirmation.
- Upload a JPG, PNG, or WebP up to 5 MB. The server validates, orients, resizes to at most 640 × 640, and re-encodes it as WebP without EXIF/location metadata. **Use a symbol instead** removes the custom photo.
- **Board settings** includes speech voices and speed, speak-on-tap, extra-large tiles, categories, and PIN changes. A category must be empty before it can be removed.
- Select **Finish editing** to revoke the caregiver session. Sessions expire after one hour. Five incorrect PIN attempts trigger a five-minute cooldown.

The data is stored in **`data/connectus.db`**, not just in browser memory. Restarting the server preserves tiles, custom photos, categories, and the caregiver PIN. Browser preferences stay on that device. Back up the whole `data/` directory while the server is stopped. There is no PIN recovery UI yet; keep your PIN somewhere safe.

## Offline behavior

Wait for **Saved for offline** in the footer while online. That status appears after the service worker is ready, the board has been stored in IndexedDB, and all current pictures and phrase recordings have downloaded. You can also retry with **Save for offline**.

The saved board can reopen, switch categories, show custom photos, and build sentences without a connection or a running local server. Offline editing, new sign-ins, and cross-device sync are deferred. Browser data clearing/eviction removes the offline copy; it is not a substitute for a database backup.

The standard board uses **Sarah**, one warm, calm ElevenLabs voice. All 83 starter tiles have recordings (76 unique phrases), saved locally with the offline board. Speak plays the recordings in sequence. Custom phrases without recordings fall back to device speech; choose an **on device** fallback voice for those phrases. Normal app use makes no ElevenLabs calls and consumes no credits. Actual audio still needs testing on the child's device. See [voice pack details and regeneration](docs/voice-pack.md).

## Stack and deployment path

- Next.js App Router + React + TypeScript for the interface and API routes.
- SQLite via `@libsql/client` for zero-setup local persistence; compatible with hosted Turso through environment variables.
- Sharp for validated photo processing. Small, normalized photo bytes are stored in the database, so this version doesn't require a separate storage service.
- IndexedDB + a build-versioned service worker for offline reading.
- Plain CSS, locally bundled DM Sans, Lucide icons, and the existing pictograms. No third-party runtime font or image requests.

Nothing has been deployed. For a later **private single-board deployment on Vercel**, configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` securely in the dashboard and use `npm run build`. SQLite files on Vercel's local filesystem are not persistent; the app refuses that configuration. The same app can run on Railway with persistent storage or with Turso.

Before a public multi-family launch, add caregiver accounts, board membership/ownership authorization on **all** reads and writes (including photos), account recovery, and scoped offline storage. Today there is intentionally one shared board, and anyone who can reach the server can view it. Use access-protected hosting for a private preview. See [architecture notes](docs/architecture.md) for the next steps.

## Verification

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

If Google Chrome is already installed, `PLAYWRIGHT_CHANNEL=chrome npm test` uses it instead. Tests start an isolated server on port 3100 and a separate `data/e2e-*.db`; they do not change the local board on port 3000.

The tests cover authorization, origin validation, caregiver setup/unlock, recorded speech and fallback behavior, photos surviving reload, offline page reload with a custom photo and working recorded speech, online reconnection, invalid-image rejection, category/tile creation and deletion, mobile overflow, keyboard dialog behavior, and automated WCAG accessibility checks. Test databases and screenshots are ignored by Git.

## Original MVP and artwork

The original `index.html`, `assets/`, `audio/`, and `pictograms/` remain intact as a reference. The running application is in `src/`; its static assets are in `public/`.

ARASAAC pictograms: Sergio Palao / Government of Aragón, [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Attribution is visible in the app. See [pictogram attribution](public/pictograms/ATTRIBUTION.md). The non-commercial license matters for future commercial use. The four added SVG symbols (`again`, `look`, `wash`, `it`) and app icon are original application artwork. DM Sans's license is included in `public/fonts/LICENSE`. Caregiver photos are not ARASAAC artwork.
