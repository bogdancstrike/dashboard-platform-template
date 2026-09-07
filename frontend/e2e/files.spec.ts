import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * The file manager against the real stack, with real object storage (§20).
 *
 * The claim only this level can prove: **the bytes never pass through the
 * API**. The browser is handed a presigned URL, PUTs at MinIO directly, and
 * gets the file back the same way — and the network log says so.
 *
 * Serial, and every test removes what it uploaded: this writes to the same
 * MinIO bucket and PostgreSQL the rest of the suite reads.
 */
test.describe.configure({ mode: "serial" });

/**
 * Anything this file uploaded, gone — whether the test that uploaded it
 * passed. A run that fails mid-way otherwise leaves a file behind, and the
 * next run then reads *that* as the seeded one.
 */
test.afterEach(async ({ page }) => {
  await page.goto("/files");
  const list = page.getByTestId("file-list");
  if ((await list.count()) === 0) return;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const leftover = list.locator(".ant-table-row").filter({ hasText: /^e2e-/ }).first();
    if ((await leftover.count()) === 0) return;
    const name = ((await leftover.locator("td").first().innerText()) ?? "").trim();
    await page.getByLabel(`Delete ${name}`).click();
    await page.locator(".ant-modal-confirm").getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(".ant-modal-confirm")).toBeHidden();
  }
});

const CONTENT = "# Playwright upload\n\nWritten straight to object storage.\n";

test("a dropped file goes to storage, not through the API", async ({ page }) => {
  const name = `e2e-${Date.now()}.md`;
  const requests: string[] = [];
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT") requests.push(request.url());
    if (request.method() === "GET" && request.url().includes("X-Amz-Signature")) {
      downloads.push(request.url());
    }
  });

  await signIn(page, "admin", "/files");
  await expect(page.getByTestId("folder-tree")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "text/markdown",
    buffer: Buffer.from(CONTENT),
  });

  // The tray reports this file by name, with its own progress.
  const tray = page.getByTestId("upload-tray");
  await expect(tray.getByText(name)).toBeVisible();

  // And the PUT went to MinIO's own address rather than to the API's.
  await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(requests.some((url) => url.includes(":9000/"))).toBe(true);
  expect(requests.some((url) => url.includes("/platform/api/"))).toBe(false);

  // Confirmed, so it appears as a *row* anybody can open. A row rather than
  // any text: the upload tray sits in the same pane and names the file too, so
  // matching text alone would pass on a transfer that was never confirmed.
  await expect(
    page.getByTestId("file-list").locator(".ant-table-row").filter({ hasText: name }),
  ).toBeVisible();

  // Downloading hands back a signed URL the browser follows itself. Observed
  // as a *request* rather than by reading a popup's address: a signed
  // download arrives as `Content-Disposition: attachment`, so the window the
  // page opens may never navigate at all.
  await page.getByLabel(`Download ${name}`).click();
  await expect.poll(() => downloads.length, { timeout: 15_000 }).toBeGreaterThan(0);

  const url = downloads[0]!;
  expect(url).toContain(":9000/");
  const fetched = await page.request.get(url);
  expect(fetched.status()).toBe(200);
  expect(await fetched.text()).toBe(CONTENT);

  // Put the library back where it was found.
  await page.getByLabel(`Delete ${name}`).click();
  await page.locator(".ant-modal-confirm").getByRole("button", { name: "Delete" }).click();
  await expect(
    page.getByTestId("file-list").locator(".ant-table-row").filter({ hasText: name }),
  ).toHaveCount(0);
});

test("a seeded file downloads as the format it claims to be", async ({ page }) => {
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes("X-Amz-Signature")) {
      downloads.push(request.url());
    }
  });

  await signIn(page, "admin", "/files");
  // A *seeded* file, so anything this suite uploaded is excluded — a leftover
  // from a failed run would otherwise be read as the seed's own work.
  const rows = page
    .getByTestId("file-list")
    .locator(".ant-table-row")
    .filter({ hasNotText: /^e2e-/ });
  await expect(rows.first()).toBeVisible();

  // Whichever file the open folder holds, rather than hunting for a format:
  // the claim is that the *bytes match the extension*, and every seeded format
  // has to hold that — a `.pdf` whose bytes are plain text is a file that
  // fails in the reader somebody opens it with.
  const name = ((await rows.first().locator("td").first().innerText()) ?? "").trim();
  await page.getByLabel(`Download ${name}`).click();
  await expect.poll(() => downloads.length, { timeout: 15_000 }).toBeGreaterThan(0);

  const fetched = await page.request.get(downloads[0]!);
  expect(fetched.status()).toBe(200);
  const body = await fetched.body();
  expect(body.length).toBeGreaterThan(0);

  const signatures: Record<string, Buffer> = {
    pdf: Buffer.from("%PDF-"),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    svg: Buffer.from("<svg"),
  };
  const extension = name.split(".").pop() ?? "";
  const expected = signatures[extension];
  if (expected) {
    expect(body.subarray(0, expected.length)).toEqual(expected);
  } else {
    // The text formats: real content about the thing the list said it was,
    // rather than a placeholder.
    expect(body.toString()).toContain(name.replace(/\.[^.]+$/, ""));
  }
});

test("an executable is refused before anything is transferred", async ({ page }) => {
  const requests: string[] = [];
  const downloads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT") requests.push(request.url());
    if (request.method() === "GET" && request.url().includes("X-Amz-Signature")) {
      downloads.push(request.url());
    }
  });

  await signIn(page, "admin", "/files");
  await expect(page.getByTestId("folder-tree")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "payload.sh",
    mimeType: "text/x-shellscript",
    buffer: Buffer.from("#!/bin/sh\necho no\n"),
  });

  const tray = page.getByTestId("upload-tray");
  await expect(tray.getByText(/not accepted here/)).toBeVisible();
  // Refused at the point a URL would have been issued, so nothing moved.
  expect(requests).toHaveLength(0);
});

test("a viewer reads the library and is told what uploading needs", async ({ browser }) => {
  const context = await browser.newContext({ storageState: storageStateFor("viewer") });
  const page = await context.newPage();
  await signIn(page, "viewer", "/files");

  await expect(page.getByTestId("file-list").locator(".ant-table-row").first()).toBeVisible();
  // §76: shown and refused, so a reader can see the feature exists.
  await expect(page.getByTestId("new-folder")).toBeDisabled();
  await expect(page.getByTestId("dropzone")).toHaveCount(0);
  await context.close();
});

test("the library is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/files");
  await expect(page.getByTestId("file-list").locator(".ant-table-row").first()).toBeVisible();

  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
  const audit = await new AxeBuilder({ page }).include("#nu-main").analyze();
  const serious = audit.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(
    serious.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => `${node.target.join(" ")} :: ${node.failureSummary}`),
    })),
  ).toEqual([]);
});
