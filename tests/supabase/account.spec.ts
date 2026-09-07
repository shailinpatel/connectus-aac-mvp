import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import AxeBuilder from "@axe-core/playwright";
const config = JSON.parse(fs.readFileSync("data/supabase-status.json", "utf8"));
if (new URL(config.API_URL).hostname !== "127.0.0.1")
  throw new Error("Use disposable local Supabase for tests.");
const key = config.PUBLISHABLE_KEY || config.ANON_KEY;
const admin = createClient(
  config.API_URL,
  config.SECRET_KEY || config.SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

test("Google entry, callback validation, and signed-out authorization", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  expect((await request.get("/api/board")).status()).toBe(401);
  expect((await request.get("/api/photos/" + randomUUID())).status()).toBe(401);
  expect(
    (
      await request.post("/auth/google", {
        headers: { Origin: "https://foreign.example" },
      })
    ).status(),
  ).toBe(403);
  const signin = await request.post("/auth/google", {
    headers: { Origin: "http://127.0.0.1:3300" },
  });
  expect(signin.status()).toBe(200);
  const redirect = new URL((await signin.json()).url);
  expect(redirect.pathname).toBe("/auth/v1/authorize");
  expect(redirect.searchParams.get("provider")).toBe("google");
  expect(redirect.searchParams.get("redirect_to")).toBe(
    "http://127.0.0.1:3300/auth/callback",
  );
  expect(redirect.searchParams.has("code_challenge")).toBe(true);
  await page.goto("/auth/callback?next=https://evil.example");
  await expect(page).toHaveURL(
    /127\.0\.0\.1:3300\/\?auth=failed|127\.0\.0\.1:3300\/$/,
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/google-signin-phone.png",
    fullPage: true,
  });
});

test("Private photo, offline voice, sign-out cleanup and stale cross-tab response", async ({
  page,
  context,
}) => {
  const email = `browser-${randomUUID()}@example.test`,
    password = randomBytes(24).toString("hex");
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(created.error).toBeNull();
  const id = created.data.user!.id;
  const login = createClient(config.API_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await login.auth.signInWithPassword({ email, password });
  expect(signed.error).toBeNull();
  const jar = new Map<
    string,
    { name: string; value: string; options: Record<string, unknown> }
  >();
  const ssr = createServerClient(config.API_URL, key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
    },
    cookies: {
      getAll: () => [...jar.values()],
      setAll: (values) => values.forEach((c) => jar.set(c.name, c)),
    },
  });
  await ssr.auth.setSession(signed.data.session!);
  await context.addCookies(
    [...jar.values()].map((c) => ({
      name: c.name,
      value: c.value,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax" as const,
    })),
  );
  let boardId = "";
  try {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Saved for offline", exact: true }),
    ).toBeVisible();
    const board = await (
      await context.request.get("http://127.0.0.1:3300/api/board")
    ).json();
    boardId = board.id;
    expect(board.ownerId).toBe(id);
    expect(
      (
        await context.request.post("http://127.0.0.1:3300/api/categories", {
          headers: { Origin: "http://127.0.0.1:3300" },
          data: { name: "Forbidden", color: "blue" },
        })
      ).status(),
    ).toBe(401);
    await page
      .getByRole("button", { name: "Caregiver mode", exact: true })
      .click();
    await page
      .getByLabel("Create a caregiver PIN", { exact: true })
      .fill("4826");
    await page.getByLabel("Confirm PIN", { exact: true }).fill("4826");
    await page
      .getByRole("button", { name: "Create PIN & start editing" })
      .click();
    await page.getByRole("button", { name: "Edit More", exact: true }).click();
    await page
      .getByLabel("Upload a custom photo")
      .setInputFiles(path.resolve("pictograms/love.png"));
    await page.getByRole("button", { name: "Save tile", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Saved for offline", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Finish editing", exact: true })
      .click();
    const src = await page
      .getByRole("button", { name: "Say More", exact: true })
      .locator("img")
      .getAttribute("src");
    expect(src).toMatch(/^\/api\/photos\//);
    const response = await context.request.get("http://127.0.0.1:3300" + src);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    await page.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        this.addEventListener("ended", () => {
          (window as unknown as { completed: boolean }).completed = true;
        });
        return play.call(this);
      };
    });
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Say More", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Say More", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { completed: boolean }).completed,
        ),
      )
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "Caregiver mode", exact: true }),
    ).toBeDisabled();
    expect(
      await page
        .getByRole("button", { name: "Say More", exact: true })
        .locator("img")
        .evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
    ).toBe(true);
    await context.setOffline(false);
    await expect(
      page.getByRole("button", { name: "Caregiver mode", exact: true }),
    ).toBeEnabled();
    const peer = await context.newPage();
    await peer.goto("/");
    await expect(
      peer.getByRole("button", { name: "Say More", exact: true }),
    ).toBeVisible();
    let captured!: () => void, release!: () => void;
    const capturedResponse = new Promise<void>(
      (resolve) => (captured = resolve),
    );
    const releaseResponse = new Promise<void>((resolve) => (release = resolve));
    await peer.route("**/api/board", async (route) => {
      const response = await route.fetch();
      captured();
      await releaseResponse;
      await route.fulfill({ response });
    });
    await peer.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await capturedResponse;
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Sign out & remove saved board",
        exact: true,
      })
      .click();
    release();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    await expect(
      peer.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () => {
        const keys = await caches.keys();
        return keys.filter((k) => k.startsWith("connectus-pictures-"));
      }),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const req = indexedDB.open("connectus", 1);
            req.onsuccess = () => {
              const db = req.result;
              const r = db.transaction("boards").objectStore("boards").count();
              r.onsuccess = () => {
                resolve(r.result);
                db.close();
              };
            };
          }),
      ),
    ).toBe(0);
    expect(
      (await context.request.get("http://127.0.0.1:3300" + src)).status(),
    ).toBe(401);
    await context.setOffline(true);
    await peer.reload();
    await expect(
      peer.getByRole("button", { name: "Say More", exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.setOffline(false);
    if (boardId) {
      const files = await login.storage.from("board-photos").list(boardId);
      if (files.data?.length)
        await admin.storage
          .from("board-photos")
          .remove(files.data.map((f) => `${boardId}/${f.name}`));
    }
    await admin.auth.admin.deleteUser(id);
  }
});
