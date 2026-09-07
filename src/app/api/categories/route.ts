import { usesSupabase } from "@/lib/backend";
import { cloudMutate } from "@/lib/supabase/store";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireCaregiver } from "@/lib/auth";
import { BOARD_ID, db, getBoard } from "@/lib/db";
import { failure, HttpError, jsonBody } from "@/lib/http";
import { palette } from "@/lib/types";
export async function POST(request: Request) {
  try {
    await requireCaregiver(request);
    const c = z
      .object({
        name: z.string().trim().min(1, "Enter a category name.").max(32),
        color: z.enum(palette),
      })
      .parse(await jsonBody(request));
    if (usesSupabase())
      return Response.json(await cloudMutate("category-create", c), {
        status: 201,
      });
    await db().execute({
      sql: "INSERT INTO categories VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1)+1 FROM categories))",
      args: [randomUUID(), BOARD_ID, c.name, c.color],
    });
    return Response.json(await getBoard(), { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    await requireCaregiver(request);
    const { id } = z
      .object({ id: z.string().min(1).max(80) })
      .parse(await jsonBody(request));
    if (usesSupabase())
      return Response.json(await cloudMutate("category-delete", { id }));
    const tx = await db().transaction("write");
    try {
      const count = await tx.execute({
        sql: "SELECT COUNT(*) AS n FROM tiles WHERE category_id=? AND board_id=?",
        args: [id, BOARD_ID],
      });
      if (Number(count.rows[0].n))
        throw new HttpError(
          409,
          "Move or remove the tiles in this category first.",
        );
      const remaining = await tx.execute({
        sql: "SELECT COUNT(*) AS n FROM categories WHERE board_id=?",
        args: [BOARD_ID],
      });
      if (Number(remaining.rows[0].n) <= 1)
        throw new HttpError(409, "Keep at least one category on your board.");
      await tx.execute({
        sql: "DELETE FROM categories WHERE id=? AND board_id=?",
        args: [id, BOARD_ID],
      });
      await tx.commit();
    } finally {
      tx.close();
    }
    return Response.json(await getBoard());
  } catch (error) {
    return failure(error);
  }
}
