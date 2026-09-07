import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { cloudCaregiver } from "@/lib/supabase/store";
import { failure, sameOrigin, HttpError } from "@/lib/http";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const client = await supabaseServer();
    try {
      await cloudCaregiver("lock");
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 401)) throw e;
    }
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error && ![401, 403, 404].includes(error.status || 0))
      throw new HttpError(503, "Could not sign out. Reconnect and try again.");
    (await cookies()).delete("connectus-caregiver");
    return Response.json(
      { signedOut: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
