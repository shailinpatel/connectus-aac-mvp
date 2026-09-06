import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { requireCaregiver } from "@/lib/auth";
import { BOARD_ID, db, getBoard } from "@/lib/db";
import { failure, HttpError, jsonBody } from "@/lib/http";
import { symbols } from "@/lib/types";

const schema = z.object({
  id: z.string().min(1).max(80).optional(),
  text: z
    .string()
    .trim()
    .min(1, "Give this tile a word or phrase.")
    .max(120, "Keep phrases under 120 characters."),
  categoryId: z.string().min(1).max(80),
  symbol: z.enum([...symbols, "again", "look", "wash", "it"]),
  isFavorite: z.boolean(),
  removePhoto: z.boolean().default(false),
});
async function save(request: Request, editing: boolean) {
  try {
    await requireCaregiver(request);
    if (Number(request.headers.get("content-length")) > 6 * 1024 * 1024)
      throw new HttpError(413, "Choose a photo smaller than 5 MB.");
    const form = await request.formData();
    const raw = form.get("data");
    if (typeof raw !== "string" || raw.length > 16000)
      throw new HttpError(400, "Could not read this tile.");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Could not read this tile.");
    }
    const tile = schema.parse(parsed);
    const photo = form.get("photo");
    let bytes: Buffer | null = null;
    if (photo instanceof File && photo.size) {
      if (photo.size > 5 * 1024 * 1024)
        throw new HttpError(413, "Choose a photo smaller than 5 MB.");
      if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type))
        throw new HttpError(400, "Choose a JPG, PNG, or WebP photo.");
      try {
        const input = sharp(Buffer.from(await photo.arrayBuffer()), {
          limitInputPixels: 40000000,
        });
        const info = await input.metadata();
        if (!["jpeg", "png", "webp"].includes(info.format || ""))
          throw new Error("Invalid image format");
        // Decode, orient, resize and re-encode; no EXIF/location metadata is retained.
        bytes = await input
          .rotate()
          .resize(640, 640, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
      } catch {
        throw new HttpError(
          400,
          "This photo couldn't be opened. Try a different JPG, PNG, or WebP.",
        );
      }
    }
    const tx = await db().transaction("write");
    try {
      const category = await tx.execute({
        sql: "SELECT id FROM categories WHERE id=? AND board_id=?",
        args: [tile.categoryId, BOARD_ID],
      });
      if (!category.rows.length)
        throw new HttpError(400, "Choose an existing category.");
      let oldPhoto: string | null = null;
      if (editing) {
        if (!tile.id) throw new HttpError(400, "Choose a tile to edit.");
        const existing = await tx.execute({
          sql: "SELECT photo_id FROM tiles WHERE id=? AND board_id=?",
          args: [tile.id, BOARD_ID],
        });
        if (!existing.rows.length)
          throw new HttpError(
            404,
            "That tile no longer exists. Refresh your board.",
          );
        oldPhoto = existing.rows[0].photo_id as string | null;
      }
      const photoId = bytes ? randomUUID() : tile.removePhoto ? null : oldPhoto;
      if (bytes)
        await tx.execute({
          sql: "INSERT INTO photos VALUES (?, ?, ?)",
          args: [photoId, BOARD_ID, bytes],
        });
      if (editing)
        await tx.execute({
          sql: "UPDATE tiles SET category_id=?, text=?, symbol=?, photo_id=?, is_favorite=? WHERE id=? AND board_id=?",
          args: [
            tile.categoryId,
            tile.text,
            tile.symbol,
            photoId,
            Number(tile.isFavorite),
            tile.id!,
            BOARD_ID,
          ],
        });
      else
        await tx.execute({
          sql: "INSERT INTO tiles VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1)+1 FROM tiles WHERE category_id=?))",
          args: [
            randomUUID(),
            BOARD_ID,
            tile.categoryId,
            tile.text,
            tile.symbol,
            photoId,
            Number(tile.isFavorite),
            tile.categoryId,
          ],
        });
      if (oldPhoto && oldPhoto !== photoId)
        await tx.execute({
          sql: "DELETE FROM photos WHERE id=?",
          args: [oldPhoto],
        });
      await tx.commit();
    } finally {
      tx.close();
    }
    return Response.json(await getBoard(), { status: editing ? 200 : 201 });
  } catch (error) {
    return failure(error);
  }
}
export const POST = (request: Request) => save(request, false);
export const PATCH = (request: Request) => save(request, true);
export async function DELETE(request: Request) {
  try {
    await requireCaregiver(request);
    const { id } = z
      .object({ id: z.string().min(1).max(80) })
      .parse(await jsonBody(request));
    const tx = await db().transaction("write");
    try {
      const existing = await tx.execute({
        sql: "SELECT photo_id FROM tiles WHERE id=? AND board_id=?",
        args: [id, BOARD_ID],
      });
      if (!existing.rows.length)
        throw new HttpError(404, "This tile has already been removed.");
      await tx.execute({
        sql: "DELETE FROM tiles WHERE id=? AND board_id=?",
        args: [id, BOARD_ID],
      });
      if (existing.rows[0].photo_id)
        await tx.execute({
          sql: "DELETE FROM photos WHERE id=?",
          args: [existing.rows[0].photo_id],
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
