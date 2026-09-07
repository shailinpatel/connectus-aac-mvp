import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
const config = JSON.parse(fs.readFileSync("data/supabase-status.json", "utf8"));
assert.equal(
  new URL(config.API_URL).hostname,
  "127.0.0.1",
  "Tests must use disposable local Supabase.",
);
const admin = createClient(
  config.API_URL,
  config.SECRET_KEY || config.SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const anon = createClient(
  config.API_URL,
  config.PUBLISHABLE_KEY || config.ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const users = [];
async function user() {
  const email = `test-${randomUUID()}@example.test`,
    password = randomBytes(24).toString("hex");
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(created.error);
  users.push(created.data.user.id);
  const client = createClient(
    config.API_URL,
    config.PUBLISHABLE_KEY || config.ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const login = await client.auth.signInWithPassword({ email, password });
  assert.ifError(login.error);
  const board = await client.rpc("connectus_board");
  assert.ifError(board.error);
  return { client, board: board.data, id: created.data.user.id };
}
const pin = (client, action, token, value = "4826") =>
  client.rpc("connectus_caregiver", { action, token, pin: value });
test("Private boards, mutation locks, storage isolation, and persistent PIN cooldown", async () => {
  const a = await user(),
    b = await user();
  const token = randomBytes(32).toString("hex");
  let photoPath;
  try {
    assert.notEqual(a.board.id, b.board.id);
    assert.equal(a.board.tiles.length, 83);
    assert.equal(a.board.ownerId, a.id);
    assert.ok((await anon.rpc("connectus_board")).error);
    const foreign = await b.client
      .from("tiles")
      .select("*")
      .eq("board_id", a.board.id);
    assert.ifError(foreign.error);
    assert.deepEqual(foreign.data, []);
    assert.ok(
      (
        await a.client
          .from("boards")
          .update({ owner_id: b.id })
          .eq("id", a.board.id)
      ).error,
    );
    assert.ok(
      (
        await a.client.rpc("connectus_mutate", {
          kind: "tile-delete",
          payload: { id: "1" },
          token,
        })
      ).error,
    );
    assert.equal((await pin(a.client, "setup", token)).data.unlocked, true);
    const create = await a.client.rpc("connectus_mutate", {
      kind: "tile-create",
      payload: {
        categoryId: "1",
        text: "My special word",
        symbol: "help",
        isFavorite: false,
      },
      token,
    });
    assert.ifError(create.error);
    const after = (await a.client.rpc("connectus_board")).data;
    const tile = after.tiles.find((t) => t.text === "My special word");
    assert.ok(tile);
    const bToken = randomBytes(32).toString("hex");
    assert.equal((await pin(b.client, "setup", bToken)).data.unlocked, true);
    assert.ok(
      (
        await b.client.rpc("connectus_mutate", {
          kind: "tile-delete",
          payload: { id: tile.id },
          token: bToken,
        })
      ).error,
    );
    assert.equal(
      (await b.client.rpc("connectus_caregiver", { action: "status", token }))
        .data.unlocked,
      false,
    );
    assert.ok(
      (
        await b.client.rpc("connectus_mutate", {
          kind: "category-delete",
          payload: { id: "1" },
          token: bToken,
        })
      ).error,
    );
    const bytes = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#225544" },
    })
      .webp()
      .toBuffer();
    photoPath = `${a.board.id}/${randomUUID()}.webp`;
    assert.ifError(
      (
        await a.client.storage
          .from("board-photos")
          .upload(photoPath, bytes, { contentType: "image/webp" })
      ).error,
    );
    assert.ifError(
      (await a.client.storage.from("board-photos").download(photoPath)).error,
    );
    assert.ok(
      (await b.client.storage.from("board-photos").download(photoPath)).error,
    );
    assert.ok(
      (await anon.storage.from("board-photos").download(photoPath)).error,
    );
    assert.ok(
      (
        await b.client.storage
          .from("board-photos")
          .upload(`${a.board.id}/forbidden.webp`, bytes, {
            contentType: "image/webp",
          })
      ).error,
    );
    assert.ifError(
      (await a.client.rpc("connectus_caregiver", { action: "lock", token }))
        .error,
    );
    assert.ok(
      (
        await a.client.rpc("connectus_mutate", {
          kind: "tile-delete",
          payload: { id: tile.id },
          token,
        })
      ).error,
    );
    for (let n = 0; n < 5; n++)
      assert.equal(
        (await pin(a.client, "unlock", randomBytes(32).toString("hex"), "0000"))
          .data.status,
        401,
      );
    assert.equal(
      (await pin(a.client, "unlock", randomBytes(32).toString("hex"))).data
        .status,
      429,
    );
  } finally {
    if (photoPath)
      await a.client.storage.from("board-photos").remove([photoPath]);
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }
});
