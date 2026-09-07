import { NextResponse } from "next/server";
import { supabaseServer, siteOrigin } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const destination = new URL("/", siteOrigin());
  const code = new URL(request.url).searchParams.get("code");
  if (code) {
    const client = await supabaseServer();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) {
      destination.searchParams.set("auth", "complete");
      return NextResponse.redirect(destination, {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
  }
  destination.searchParams.set("auth", "failed");
  return NextResponse.redirect(destination, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
