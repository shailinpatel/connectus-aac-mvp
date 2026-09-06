import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import { recordingFor } from "../src/lib/recordings";

test.describe.configure({ mode: "serial" });
const origin = "http://127.0.0.1:3100";

test("server protects editing and rejects foreign origins", async ({
  request,
}) => {
  const initial = await request.get("/api/board");
  expect(initial.status()).toBe(200);
  const board = await initial.json();
  expect(board.tiles).toHaveLength(83);
  expect(board.categories).toHaveLength(8);
  expect(
    (
      await request.delete("/api/tiles", {
        headers: { Origin: origin },
        data: { id: "1" },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post("/api/caregiver", {
        headers: { Origin: "https://example.com" },
        data: { action: "setup", pin: "4826" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/caregiver", {
        headers: { Origin: origin },
        data: { action: "setup", pin: "abc" },
      })
    ).status(),
  ).toBe(400);
});

test("sentence controls, caregiver setup, photo persistence, and offline reload", async ({
  page,
  context,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.addInitScript(() => {
    const probe = window as unknown as {
      playedRecordings: string[];
      completedRecordings: string[];
    };
    probe.playedRecordings = [];
    probe.completedRecordings = [];
    const nativePlay = HTMLMediaElement.prototype.play;
    const observed = new WeakSet<HTMLMediaElement>();
    HTMLMediaElement.prototype.play = function () {
      probe.playedRecordings.push(new URL(this.src).pathname);
      if (!observed.has(this)) {
        observed.add(this);
        this.addEventListener("ended", () =>
          probe.completedRecordings.push(new URL(this.src).pathname),
        );
      }
      return nativePlay.call(this);
    };
    (window as unknown as { spokenPhrases: string[] }).spokenPhrases = [];
    window.speechSynthesis.speak = (utterance) => {
      (window as unknown as { spokenPhrases: string[] }).spokenPhrases.push(
        utterance.text,
      );
    };
    window.speechSynthesis.cancel = () => {};
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Core Words", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Saved for offline", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Say Want", exact: true }).click();
  await page.getByRole("button", { name: "Say More", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove More at position 2" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Speak my words" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { completedRecordings: string[] }
        ).completedRecordings.slice(-2),
      ),
    )
    .toEqual([recordingFor("Want")!.src, recordingFor("More")!.src]);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { playedRecordings: string[] }).playedRecordings,
    ),
  ).toEqual([
    recordingFor("Want")!.src,
    recordingFor("More")!.src,
    recordingFor("Want")!.src,
    recordingFor("More")!.src,
  ]);
  expect(
    await page.evaluate(
      () => (window as unknown as { spokenPhrases: string[] }).spokenPhrases,
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove More at position 2" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Speak my words" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "test-results/board-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Caregiver mode", exact: true })
    .click();
  await page.getByLabel("Create a caregiver PIN", { exact: true }).fill("4826");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("4826");
  await page
    .getByRole("button", { name: "Create PIN & start editing" })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish editing" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit More", exact: true }).click();
  await page.getByLabel("Word or phrase", { exact: true }).fill("My teddy");
  await page
    .getByLabel("Upload a custom photo")
    .setInputFiles(path.resolve("pictograms/love.png"));
  await page.screenshot({ path: "test-results/editor.png" });
  await page.getByRole("button", { name: "Save tile", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Say My teddy", exact: true }),
  ).toBeVisible();
  const src = await page
    .getByRole("button", { name: "Say My teddy", exact: true })
    .locator("img")
    .getAttribute("src");
  expect(src).toMatch(/^\/api\/photos\//);
  const photo = await page.request.get(src!);
  expect(photo.status()).toBe(200);
  expect(photo.headers()["content-type"]).toBe("image/webp");
  expect((await photo.body()).length).toBeGreaterThan(100);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Say My teddy", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Saved for offline", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Finish editing" }).click();
  await expect(
    page.getByRole("button", { name: "Edit My teddy", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.delete("/api/tiles", {
        headers: { Origin: origin },
        data: { id: "1" },
      })
    ).status(),
  ).toBe(401);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText("You’re using the last saved board.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Say My teddy", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Caregiver mode", exact: true }),
  ).toBeDisabled();
  expect(
    await page
      .getByRole("button", { name: "Say My teddy", exact: true })
      .locator("img")
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
  ).toBe(true);
  await page.getByRole("button", { name: "Say My teddy", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove My teddy at position 1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Say Help", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { completedRecordings: string[] }
        ).completedRecordings.at(-1),
      ),
    )
    .toBe(recordingFor("Help")!.src);
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "Caregiver mode", exact: true }),
  ).toBeEnabled({ timeout: 12000 });
  expect(pageErrors).toEqual([]);
});

test("missing recording falls back to device speech", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () =>
      Promise.reject(new DOMException("Unavailable", "NotSupportedError"));
    (window as unknown as { fallbackText: string }).fallbackText = "";
    window.speechSynthesis.speak = (utterance) => {
      (window as unknown as { fallbackText: string }).fallbackText =
        utterance.text;
    };
    window.speechSynthesis.cancel = () => {};
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Say Help", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { fallbackText: string }).fallbackText,
      ),
    )
    .toBe("Help");
  await expect(page.getByRole("status")).toContainText("Recording unavailable");
});

test("caregiver create, validation, category management, photo removal, and delete", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Caregiver mode", exact: true })
    .click();
  await page.getByLabel("Caregiver PIN", { exact: true }).fill("1111");
  await page
    .getByRole("button", { name: "Unlock caregiver mode", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "wasn't correct",
  );
  await page.getByLabel("Caregiver PIN", { exact: true }).fill("4826");
  await page
    .getByRole("button", { name: "Unlock caregiver mode", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Board settings", exact: false })
    .click();
  await page.getByLabel("New category", { exact: true }).fill("My things");
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove empty category My things" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "My things", exact: true }).click();
  await page.getByRole("button", { name: "Add tile", exact: true }).click();
  await page.getByLabel("Word or phrase", { exact: true }).fill("My blanket");
  await page.getByLabel("Upload a custom photo").setInputFiles({
    name: "invalid.png",
    mimeType: "image/png",
    buffer: Buffer.from("not actually an image"),
  });
  await page.getByRole("button", { name: "Save tile", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "couldn't be opened",
  );
  await page
    .getByRole("button", { name: "Use a symbol instead", exact: true })
    .click();
  await page.getByRole("button", { name: "Save tile", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Say My blanket", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit My blanket", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete tile", exact: true }).click();
  await page.getByRole("button", { name: "Remove tile", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Say My blanket", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Core Words", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit My teddy", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use a symbol instead", exact: true })
    .click();
  await page.getByLabel("Word or phrase", { exact: true }).fill("More");
  await page.getByRole("button", { name: "Save tile", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Say More", exact: true }).locator("img"),
  ).toHaveAttribute("src", "/pictograms/more.png");
});

test("mobile layout and accessibility", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Say More", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/board-mobile.png",
    fullPage: true,
  });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("button", { name: "School", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "School", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Caregiver mode", exact: true })
    .click();
  await page.getByLabel("Caregiver PIN", { exact: true }).fill("4826");
  await page
    .getByRole("button", { name: "Unlock caregiver mode", exact: true })
    .click();
  await page.getByRole("button", { name: "Add tile", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add tile", exact: true }),
  ).toBeFocused();
});
