import { usesSupabase } from "./backend";
import { cloudCaregiver } from "./supabase/store";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { db, initialize } from "./db";
import { HttpError, sameOrigin } from "./http";
export const SESSION_COOKIE = "connectus-caregiver";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pin, salt, 64).toString("hex")}`;
}
export function verifyPin(pin: string, stored: string) {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(scryptSync(pin, salt, 64), Buffer.from(hash, "hex"));
}
export async function authenticated() {
  if (usesSupabase()) return (await cloudCaregiver("status")).unlocked;
  await initialize();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const result = await db().execute({
    sql: "SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?",
    args: [hashToken(token), Date.now()],
  });
  return result.rows.length > 0;
}
export async function requireCaregiver(request: Request) {
  sameOrigin(request);
  if (!(await authenticated()))
    throw new HttpError(401, "Unlock caregiver mode to make changes.");
}
