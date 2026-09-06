import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import seed from "./seed.json";
import type { Board, Category, Tile } from "./types";

const globalDb = globalThis as unknown as {
  connectusDb?: Client;
  connectusInit?: Promise<void>;
};
export function db() {
  if (!globalDb.connectusDb) {
    if (process.env.VERCEL && !process.env.TURSO_DATABASE_URL)
      throw new Error(
        "Configure TURSO_DATABASE_URL before deploying to Vercel.",
      );
    if (!process.env.TURSO_DATABASE_URL) mkdirSync("data", { recursive: true });
    globalDb.connectusDb = createClient({
      url:
        process.env.TURSO_DATABASE_URL ||
        process.env.DATABASE_URL ||
        "file:data/connectus.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return globalDb.connectusDb;
}
export async function initialize() {
  globalDb.connectusInit ??= (async () => {
    const client = db();
    await client.executeMultiple(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id), name TEXT NOT NULL, color TEXT NOT NULL, sort_order INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id), bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS tiles (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id), category_id TEXT NOT NULL REFERENCES categories(id), text TEXT NOT NULL, symbol TEXT NOT NULL, photo_id TEXT REFERENCES photos(id), is_favorite INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS caregiver (id INTEGER PRIMARY KEY CHECK(id=1), pin_hash TEXT NOT NULL, failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS tiles_board ON tiles(board_id, category_id, sort_order);
    `);
    // Seed once, transactionally. A restart must never resurrect a caregiver's deleted tiles.
    const tx = await client.transaction("write");
    try {
      const existing = await tx.execute("SELECT id FROM boards LIMIT 1");
      if (!existing.rows.length) {
        await tx.execute({
          sql: "INSERT INTO boards VALUES (?, ?)",
          args: [seed.id, seed.name],
        });
        for (const c of seed.categories)
          await tx.execute({
            sql: "INSERT INTO categories VALUES (?, ?, ?, ?, ?)",
            args: [c.id, seed.id, c.name, c.color, c.sortOrder],
          });
        for (const t of seed.tiles)
          await tx.execute({
            sql: "INSERT INTO tiles VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            args: [
              t.id,
              seed.id,
              t.categoryId,
              t.text,
              t.symbol,
              null,
              Number(t.isFavorite),
              t.sortOrder,
            ],
          });
      }
      await tx.commit();
    } finally {
      tx.close();
    }
  })().catch((error) => {
    globalDb.connectusInit = undefined;
    throw error;
  });
  await globalDb.connectusInit;
}
export const BOARD_ID = "local-board";
export async function getBoard(): Promise<Board> {
  await initialize();
  const [boards, cats, tiles] = await Promise.all([
    db().execute({ sql: "SELECT * FROM boards WHERE id=?", args: [BOARD_ID] }),
    db().execute({
      sql: "SELECT id, name, color, sort_order AS sortOrder FROM categories WHERE board_id=? ORDER BY sort_order, id",
      args: [BOARD_ID],
    }),
    db().execute({
      sql: "SELECT id, category_id AS categoryId, text, symbol, photo_id AS photoId, is_favorite AS isFavorite, sort_order AS sortOrder FROM tiles WHERE board_id=? ORDER BY sort_order, id",
      args: [BOARD_ID],
    }),
  ]);
  return {
    id: BOARD_ID,
    name: String(boards.rows[0].name),
    categories: cats.rows as unknown as Category[],
    tiles: tiles.rows.map((t) => ({
      ...t,
      isFavorite: Boolean(t.isFavorite),
    })) as unknown as Tile[],
  };
}
