import { getBoard } from "@/lib/db";
import { failure } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(await getBoard(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
