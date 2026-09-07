# Connectus backend and account boundaries

## Two environments

The default environment preserves the original single-board SQLite demo and the caregiver's existing PIN and photos. It requires no cloud credentials. Configuring the Supabase URL and publishable key switches every board, category, tile, photo, and caregiver route to Supabase. Partial configuration is an error, and Vercel requires Supabase. Local data is not silently imported into any Google account.

Next.js serves a static interface shell and dynamic API routes. No account, board, or child data is server-rendered into the cached shell. Google authentication starts with a same-origin POST, uses Supabase OAuth with PKCE, exchanges the code on the server, and redirects to a fixed configured origin. Tokens remain in HTTP-only cookies. API handlers create a fresh Supabase client per request and verify the current user, refreshing cookies as necessary.

## Private boards and editing

One authenticated account owns one board. The first board read transactionally creates the standard categories and vocabulary once. Stable category IDs preserve the familiar icons. Categories and tiles use composite board-scoped keys; their relationships cannot cross board boundaries. RLS filters every direct table read by the owner. Signed-out users cannot open a board or photo.

Mutation RPCs run in transactions, check the caller's ownership, require a hashed caregiver-session token, and serialize board modifications with a board-row lock. Database users have no direct table-write grants. PINs and sessions are held in a private, unexposed schema; sessions bind to the owner, board, and Supabase auth-session ID. PIN cooldowns persist in Postgres. The PIN remains a child-facing editing lock within the caregiver account; it does not replace Google authentication.

Normalized photos live in a private Storage bucket under `board-id/photo-id.webp`. Owner policies protect reads, uploads, and deletion. App upload routes additionally require the editing PIN and re-encode accepted images to WebP without location metadata. The server proxies authorized photo reads with `private, no-store`. Failed tile changes trigger new-object cleanup; successful replacement/deletion removes the old file. An interrupted Storage cleanup can leave a private orphan for later maintenance, not a broken tile transaction.

## Offline lifecycle and sign-out

The production service worker caches the public shell, scripts, styles, symbols, and voice recordings. IndexedDB stores an explicit owner-scoped board snapshot. Only one family may be enrolled per browser profile at a time. Private photos are downloaded into the explicit offline asset cache; network access is attempted first, and HTTP authorization failures never fall back to cached photos.

Online startup checks the account before displaying a saved board. A network outage allows the last enrolled board to reopen without a new sign-in. Offline use remains read-only. The default local-only legacy snapshot can be read as local data, never as a cloud account's board.

Sign-out requires connectivity and confirmation, revokes the current device's editing and refresh sessions, removes the saved board/photos/preferences, and clears visible sentences. A shared generation marker invalidates late responses, other tabs clear their visible data, and a browser lock serializes cache downloads against deletion. Changing accounts purges the previous snapshot before accepting the new board. Finishing editing only revokes the editing session, leaving communication available.

A device already offline cannot observe a remote logout. Its saved data remains available to someone using that unlocked device until it reconnects or the browser data is removed. Device enrollment and remote device management remain future work. Browser clearing/eviction can remove offline data; cloud persistence and device caches have different lifecycles.

## Source map

- `src/lib/backend.ts`: configuration and hosted fail-closed behavior.
- `src/lib/supabase/server.ts`: request-local auth client, verified user, trusted return origin.
- `src/lib/supabase/store.ts`: cloud board reads, caregiver sessions, mutations, private photo handling.
- `supabase/migrations/`: reproducible Postgres schema, policies, functions, bucket and starter vocabulary.
- `src/app/auth/`: Google entry, callback, and device sign-out.
- `src/app/api/account/`: current account/mode without private board data.
- `src/lib/db.ts`, `src/lib/auth.ts`: local SQLite persistence/PIN with Supabase dispatch.
- `src/lib/offline.ts`, `scripts/build-offline.mjs`: account-aware snapshots, asset cache, service worker.
- `tests/supabase/`: real local Postgres/Auth/Storage isolation and browser lifecycle tests.

## Remaining production work

Create and configure a dedicated hosted Connectus Supabase project, apply the committed migration, configure Google OAuth, and observe real Google sign-in. No hosting or provider configuration is claimed by local fixture tests. Caregiver invitations, PIN recovery, account deletion/storage cleanup, offline mutations, conflict resolution, and native-device enrollment are deferred. Test actual playback, PWA installation, and storage survival on the intended iPad/Android device before family use. See `supabase-setup.md` for the concrete configuration steps.
