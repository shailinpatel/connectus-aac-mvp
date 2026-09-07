import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { usesSupabase } from "../backend";
import { HttpError } from "../http";

// A new client per request. Tokens are held in HTTP-only cookies; the browser
// never needs direct database access. API routes also refresh expired sessions.
export async function supabaseServer() {
  if (!usesSupabase())
    throw new HttpError(503, "Google sign-in is not configured yet.");
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure:
          process.env.CONNECTUS_SITE_URL?.startsWith("https://") ||
          Boolean(process.env.VERCEL),
        path: "/",
      },
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) =>
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          ),
      },
    },
  );
}
export async function cloudUser() {
  const client = await supabaseServer();
  const { data, error } = await client.auth.getUser();
  if (
    error &&
    (error.status === undefined ||
      error.status >= 500 ||
      error.name === "AuthRetryableFetchError")
  )
    throw new HttpError(
      503,
      "Sign-in is temporarily unavailable. Please try again.",
    );
  if (error || !data.user || data.user.is_anonymous)
    throw new HttpError(401, "Sign in with Google to open your board.");
  return { client, user: data.user };
}
export function siteOrigin() {
  const value =
    process.env.CONNECTUS_SITE_URL ||
    (!process.env.VERCEL ? "http://127.0.0.1:3000" : "");
  if (!value)
    throw new HttpError(
      503,
      "The sign-in return address has not been configured.",
    );
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.protocol === "http:"
    )
  )
    throw new Error("Use HTTPS for the hosted site URL.");
  return url.origin;
}
