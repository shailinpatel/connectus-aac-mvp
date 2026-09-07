import { supabaseServer, siteOrigin } from "@/lib/supabase/server";
import { failure, sameOrigin, HttpError } from "@/lib/http";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const client = await supabaseServer();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${siteOrigin()}/auth/callback`,
        queryParams: { prompt: "select_account" },
        skipBrowserRedirect: true,
        scopes: "openid email profile",
      },
    });
    if (error || !data.url)
      throw new HttpError(
        503,
        "Google sign-in is not ready yet. Please try again shortly.",
      );
    return Response.json(
      { url: data.url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
