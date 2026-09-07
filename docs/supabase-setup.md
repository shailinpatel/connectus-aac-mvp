# Supabase and Google sign-in

Connectus supports two explicit environments. The existing local SQLite demo needs no credentials and keeps its current board at `data/connectus.db`. Configuring both Supabase environment variables switches all board, photo, and caregiver operations to the account-backed Supabase implementation. Vercel refuses to run without Supabase. This change does not import local photos or PINs into a cloud account.

## Account experience

1. A caregiver selects **Continue with Google**. Connectus requests only identity, email, and basic profile scopes. It does not request Gmail, Drive, or other Google data.
2. Supabase completes OAuth; the server exchanges its one-time code using PKCE. The app keeps authentication tokens in HTTP-only cookies and verifies the user on API requests.
3. The first visit creates a private board with the standard 83 tiles, eight categories, and the existing Sarah recordings. Returning users reopen their own board. One Google account owns one board in this release; sharing with another caregiver is deferred.
4. Children need no separate account. On an enrolled device, they can communicate while the caregiver account remains signed in. The caregiver PIN is a separate editing lock, with a one-hour editing session and persistent attempt throttling. **Finish editing** preserves the account session and offline board.
5. **Sign out** asks before removing the saved board, photos, preferences, and sentence on this browser, including other open tabs. The server revokes this device's Supabase refresh session and editing session. The cloud board remains. Sign-out requires a connection; the interface disables it while offline.

Offline use is read-only and device-local. The app first checks the account when online; it does not display a previous family's snapshot while waiting for authentication. When unreachable, the browser can open its last enrolled board. A confirmed signed-out/unauthorized response clears that snapshot. Saved data is scoped by owner and only one family is enrolled per browser profile. Browser storage is not encrypted against someone with access to the unlocked device. Signing out on a different device cannot remotely erase an offline copy. Offline changes and conflict resolution remain deferred.

Google handles account authentication/recovery. PIN recovery and caregiver invitations are not implemented. Keep the PIN available; changing it requires the current PIN.

## Local Supabase

Install Docker Desktop and the Supabase CLI. This project uses a separate local Supabase stack; commands below do not affect any hosted project.

```sh
supabase start -x realtime,imgproxy,edge-runtime,logflare,vector,supavisor
supabase migration up --local
npm run supabase:local-config
npm run build
npm run start:supabase
```

The helper writes `.env.supabase.local` and ignored test credentials with restrictive filesystem permissions. It refuses remote API endpoints. The app runs at `http://127.0.0.1:3300`; Studio is available at the address shown by the Supabase CLI. Google is disabled in the checked-in local configuration until real credentials are supplied. Database/auth tests use disposable local email users and do not pretend to exercise Google consent.

To enable Google locally, create a dedicated Google OAuth client, configure the local callback below, set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` securely in your shell environment, and set `[auth.external.google].enabled = true` in your local `supabase/config.toml`. Restart the local stack to apply auth configuration. Do not commit credentials.

```sh
npm run test:supabase:db
PLAYWRIGHT_CHANNEL=chrome npm run test:supabase
```

These tests check two-user isolation, anonymous denial, mutation locks, PIN cooldown persistence, private Storage access, private photo API reads, OAuth entry/PKCE and callback rejection, offline recorded speech, browser cache removal, and a delayed response in another tab arriving after logout. Only run `supabase db reset --local` on this disposable local stack; it removes its local test data.

## Hosted setup, when ready

No hosted Connectus project has been created or modified by this preparation.

1. Create a dedicated Supabase project for Connectus, separate from other apps. Record its project ref and configure the app using its URL and publishable key. The application does not need a service-role or secret key.
2. Link only that project with `supabase link --project-ref YOUR_CONNECTUS_REF`. Review and apply the committed migration with `supabase db push`. Never substitute an unrelated existing project. The migration creates the board tables, restricted RPCs, row-level policies, and a private `board-photos` bucket.
3. In Google Auth Platform, create a Web application OAuth client for Connectus. Configure the consent screen, audience/test users as appropriate, and only `openid`, email, and profile scopes. Enter the client ID and secret directly into Supabase **Authentication → Sign In / Providers → Google**. Enable Google. For a Google-only launch, disable other sign-in providers and email signups.
4. Configure these two distinct callback addresses:

| Setting | Local Supabase | Hosted Supabase |
| --- | --- | --- |
| Google OAuth authorized redirect URI | `http://127.0.0.1:54321/auth/v1/callback` | `https://YOUR_PROJECT.supabase.co/auth/v1/callback` |
| Supabase allowed app redirect URL | `http://127.0.0.1:3300/auth/callback` | `https://YOUR_APP_DOMAIN/auth/callback` |

If the local Next.js app uses a hosted Supabase project, Google uses the **hosted Supabase callback**, while Supabase redirects back to the local app. Use exact redirect URLs, not broad production wildcards.

5. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `CONNECTUS_SITE_URL` in the hosting environment. The site URL is the exact app origin, with HTTPS in production. Set the same origin as Supabase's Site URL. Rebuild after changing `NEXT_PUBLIC_*` configuration.
6. Before inviting families, observe a real Google sign-in/cancel/re-authentication cycle, two distinct Google accounts with isolated boards, sign-out, and offline playback on the intended iPad/phone. Local fixture tests do not establish provider consent or physical-device behavior.

## Data boundaries

- `boards.owner_id` references `auth.users`; table reads use ownership RLS. Categories and tiles have composite board-scoped keys and foreign keys, preventing cross-board category references.
- Direct table writes are not granted to authenticated users. Transactional RPCs validate the caller, board, and hashed editing-session token; the server supplies this token from its HTTP-only PIN cookie. Editing sessions are also bound to the Supabase auth session ID.
- PIN hashes and editing sessions are in a schema excluded from the Data API. Security-definer functions have explicit grants, fixed search paths, and caller checks. Failed PIN attempts return error values so the transaction commits its cooldown counter.
- Storage objects use `board-id/photo-id.webp` in a private bucket. Storage policies permit only the owner to read/upload/remove files. App upload routes additionally require the PIN, validate and normalize images, and strip metadata. Storage owner permissions are account-level, while the PIN protects app editing.
- Photo API responses are private and non-cacheable by HTTP intermediaries. The service worker uses the network first for private photos and falls back to the enrolled device's explicit offline cache only on network failure, never on an authorization denial.
- Uploaded files are removed if the tile mutation fails. Replaced/deleted files are removed after a successful mutation. A Storage outage after commit may leave an unreferenced private object; cleanup failures are logged for a future maintenance job. Account deletion needs a Storage cleanup workflow before it is exposed in the product.

References: [Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google), [Next.js server-side auth](https://supabase.com/docs/guides/auth/server-side), [private Storage](https://supabase.com/docs/guides/storage/buckets/fundamentals).
