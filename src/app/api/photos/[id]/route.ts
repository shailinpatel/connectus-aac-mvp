import { BOARD_ID, db, initialize } from "@/lib/db";
import { failure } from "@/lib/http";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initialize();
    const { id } = await params;
    const result = await db().execute({
      sql: "SELECT bytes FROM photos WHERE id=? AND board_id=?",
      args: [id, BOARD_ID],
    });
    if (!result.rows.length)
      return new Response("Photo not found", { status: 404 });
    return new Response(new Uint8Array(result.rows[0].bytes as ArrayBuffer), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
