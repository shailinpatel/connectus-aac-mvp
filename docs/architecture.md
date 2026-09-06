# Local full stack MVP

## Decisions

The first release has one shared communication board and a server-side caregiver PIN. Children can communicate immediately without signing in. PIN setup is explicit, edits require a valid HTTP-only session, and finishing caregiver mode revokes the session in the database. PINs use scrypt with random salts; session tokens are random and stored only as SHA-256 hashes server-side. Mutation routes check the request origin against the browser-facing host. Failed attempts and the cooldown live in the database rather than process memory.

Next.js provides one codebase and one deployable service. SQLite makes local setup immediate. The same SQL client can target Turso without changing the route contracts. Categories, tiles, and photos carry a board ID to support future ownership. The MVP returns only the fixed local board; it does not pretend to provide accounts.

Photos are decoded with a pixel limit and a strict file-type allowlist, resized, and re-encoded on the server. Photo insertion/replacement/deletion and the associated tile change happen in one write transaction. Storing small normalized photos in the database avoids temporary local-file assumptions on serverless hosts. A future storage adapter can move images to private object storage when usage warrants it.

## Source map

- `src/components/communication-board.tsx`: communication flow, category navigation, speech, caregiver state, and cached-board loading.
- `src/components/caregiver.tsx`: PIN setup/unlock and caregiver settings.
- `src/components/tile-editor.tsx`: tile editing, uploads, and confirmed deletion.
- `src/lib/db.ts`: schema initialization, transactional one-time seeding, database client, and board serialization.
- `src/lib/seed.json`: recovered original vocabulary, categories, ordering, and favorites.
- `src/app/api/`: board reads; protected tile/category mutations; caregiver sessions; photo reads.
- `src/lib/offline.ts`: IndexedDB snapshots and picture caching.
- `scripts/build-offline.mjs`: generates a versioned service worker and offline HTML from the actual production build.

## Offline lifecycle

The home page is a static React shell; it contains no server-rendered child or caregiver data. Online board reads update the visible state immediately and serialize cache writes. Offline startup restores the last IndexedDB snapshot. The production service worker pre-caches the generated shell, JavaScript, CSS, font files, and icons; all board pictures are downloaded separately. Caregiver endpoints and mutation responses are never cached. Old photo cache entries are removed after a successful full snapshot download.

An offline session is read-only. No write queue exists, so the app never claims that unsent edits have synced. A restored connection refreshes from the server. The service worker follows the normal waiting lifecycle on a new build, keeping existing tabs on their current shell until they close. Changes to the data contract will need explicit IndexedDB migration and shell compatibility handling.

## Future accounts and devices

1. Add managed caregiver authentication and account recovery. Add board memberships and scope every route and image to the authorized family; a caregiver PIN remains a secondary child-facing editing lock.
2. Scope IndexedDB and caches to the family/board. Add explicit device enrollment, logout behavior, local data removal, and shared-device handling.
3. Add a board revision and optimistic concurrency before enabling simultaneous multi-device editing. Today this is a single-caregiver local app; concurrent edits to the same tile use last-write-wins.
4. Introduce an offline mutation log with stable operation IDs, retries, conflict resolution, and observable sync status only when offline editing is required. Offline reading already works without accounts.
5. Test PWA installation, speech, touch targets, and storage survival on the intended iPads/Android devices. If native capabilities become necessary, keep the board API and vocabulary model while replacing the presentation and device-storage layers.

No analytics or external speech provider is included. ARASAAC source symbol choices are inherited from the MVP and should be reviewed with the child's caregiver or communication professional as part of tailoring the board; the editor lets them replace unfamiliar pictures.
