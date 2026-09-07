import { usesSupabase } from "@/lib/backend";
import { supabaseServer } from "@/lib/supabase/server";
import { failure, HttpError } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    if (!usesSupabase())
      return Response.json(
        { mode: "local", user: null },
        { headers: { "Cache-Control": "no-store" } },
      );
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
        "Sign-in is temporarily unavailable. Your saved board can still be used offline.",
      );
    return Response.json(
      {
        mode: "supabase",
        user:
          data.user && !data.user.is_anonymous
            ? { id: data.user.id, email: data.user.email }
            : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
