import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { cloudUser } from "./server";
import { HttpError } from "../http";
import type { Board } from "../types";
const COOKIE = "connectus-caregiver";
const BUCKET = "board-photos";
type RpcError = { code?: string; message: string };
function check(error: RpcError | null) {
  if (!error) return;
  const status =
    error.code === "42501"
      ? 403
      : error.code === "P0002"
        ? 404
        : error.code === "23514"
          ? 409
          : 500;
  if (status === 500) {
    console.error("Supabase operation failed:", error.code);
    throw new HttpError(
      500,
      "Your board could not be saved. Please try again.",
    );
  }
  throw new HttpError(status, error.message);
}
async function token() {
  return (await cookies()).get(COOKIE)?.value || "";
}
export async function cloudBoard(): Promise<Board> {
  const { client } = await cloudUser();
  const { data, error } = await client.rpc("connectus_board");
  check(error);
  return data as Board;
}
export async function cloudCaregiver(action: string, pin = "", newPin = "") {
  const { client } = await cloudUser();
  const value = ["setup", "unlock", "change"].includes(action)
    ? randomBytes(32).toString("hex")
    : await token();
  const { data, error } = await client.rpc("connectus_caregiver", {
    action,
    token: value,
    pin,
    new_pin: newPin,
  });
  check(error);
  if (data?.error) throw new HttpError(data.status, data.error);
  if (["setup", "unlock", "change"].includes(action))
    (await cookies()).set(COOKIE, value, {
      httpOnly: true,
      sameSite: "strict",
      secure:
        process.env.CONNECTUS_SITE_URL?.startsWith("https://") ||
        Boolean(process.env.VERCEL),
      path: "/",
      maxAge: 3600,
    });
  if (action === "lock") (await cookies()).delete(COOKIE);
  return data as { configured: boolean; unlocked: boolean };
}
export async function cloudMutate(
  kind: string,
  payload: Record<string, unknown>,
  bytes?: Buffer | null,
) {
  const { client } = await cloudUser();
  const board = await cloudBoard();
  let uploaded: string | null = null;
  if (bytes) {
    const id = randomUUID();
    uploaded = `${board.id}/${id}.webp`;
    const { error } = await client.storage
      .from(BUCKET)
      .upload(uploaded, bytes, { contentType: "image/webp", upsert: false });
    check(error);
    payload = { ...payload, photoId: id };
  }
  const { data, error } = await client.rpc("connectus_mutate", {
    kind,
    payload,
    token: await token(),
  });
  if (error && uploaded) await client.storage.from(BUCKET).remove([uploaded]);
  check(error);
  if (data.oldPhotoId) {
    const { error: cleanup } = await client.storage
      .from(BUCKET)
      .remove([`${board.id}/${data.oldPhotoId}.webp`]);
    if (cleanup)
      console.error("Unused photo cleanup failed; board change was saved.");
  }
  return cloudBoard();
}
export async function cloudPhoto(id: string) {
  const { client } = await cloudUser();
  const { data, error } = await client
    .from("tiles")
    .select("board_id")
    .eq("photo_id", id)
    .maybeSingle();
  check(error);
  if (!data) throw new HttpError(404, "Photo not found.");
  const result = await client.storage
    .from(BUCKET)
    .download(`${data.board_id}/${id}.webp`);
  check(result.error);
  return new Uint8Array(await result.data!.arrayBuffer());
}
