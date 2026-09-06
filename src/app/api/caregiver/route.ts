import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db, initialize } from "@/lib/db";
import {
  authenticated,
  hashPin,
  hashToken,
  SESSION_COOKIE,
  verifyPin,
} from "@/lib/auth";
import { failure, HttpError, jsonBody, sameOrigin } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await initialize();
    const result = await db().execute("SELECT id FROM caregiver WHERE id=1");
    return Response.json(
      { configured: result.rows.length > 0, unlocked: await authenticated() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { pin, action, newPin } = z
      .object({
        pin: z.string().regex(/^\d{4,8}$/, "Use 4 to 8 digits for your PIN."),
        action: z.enum(["setup", "unlock", "change"]),
        newPin: z
          .string()
          .regex(/^\d{4,8}$/)
          .optional(),
      })
      .parse(await jsonBody(request));
    await initialize();
    const tx = await db().transaction("write");
    let rejected = false;
    try {
      const result = await tx.execute("SELECT * FROM caregiver WHERE id=1");
      const caregiver = result.rows[0];
      if (action === "setup") {
        if (caregiver)
          throw new HttpError(
            409,
            "A caregiver PIN is already set. Unlock with the existing PIN.",
          );
        await tx.execute({
          sql: "INSERT INTO caregiver (id,pin_hash) VALUES (1,?)",
          args: [hashPin(pin)],
        });
      } else {
        if (!caregiver)
          throw new HttpError(400, "Create your caregiver PIN first.");
        if (Number(caregiver.locked_until) > Date.now())
          throw new HttpError(
            429,
            "Too many attempts. Wait 5 minutes before trying again.",
          );
        if (!verifyPin(pin, String(caregiver.pin_hash))) {
          const attempts =
            Number(caregiver.locked_until) > 0
              ? 1
              : Number(caregiver.failed_attempts) + 1;
          await tx.execute({
            sql: "UPDATE caregiver SET failed_attempts=?, locked_until=? WHERE id=1",
            args: [attempts, attempts >= 5 ? Date.now() + 300000 : 0],
          });
          rejected = true;
        } else {
          await tx.execute(
            "UPDATE caregiver SET failed_attempts=0, locked_until=0 WHERE id=1",
          );
          if (action === "change") {
            if (!newPin) throw new HttpError(400, "Enter a new PIN.");
            await tx.execute({
              sql: "UPDATE caregiver SET pin_hash=? WHERE id=1",
              args: [hashPin(newPin)],
            });
            await tx.execute("DELETE FROM sessions");
          }
        }
      }
      await tx.commit();
    } finally {
      tx.close();
    }
    if (rejected)
      throw new HttpError(401, "That PIN wasn't correct. Try again.");
    const token = randomBytes(32).toString("hex");
    await db().execute({
      sql: "DELETE FROM sessions WHERE expires_at<=?",
      args: [Date.now()],
    });
    await db().execute({
      sql: "INSERT INTO sessions VALUES (?, ?)",
      args: [hashToken(token), Date.now() + 3600000],
    });
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: 3600,
    });
    return Response.json({ unlocked: true });
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    await initialize();
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token)
      await db().execute({
        sql: "DELETE FROM sessions WHERE token_hash=?",
        args: [hashToken(token)],
      });
    jar.delete(SESSION_COOKIE);
    return Response.json({ unlocked: false });
  } catch (error) {
    return failure(error);
  }
}
