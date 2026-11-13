/**
 * Ask your documents end to end (§44), against the running stack: real object
 * storage, the real Docling converter and the real ingest pipeline.
 *
 * The happy path uploads a PDF, a Word document and a Markdown file, waits
 * for each to be read, asks a question and opens a citation at its page. The
 * error paths prove an upload that cannot work says why: a file too large, a
 * kind the converter cannot read, and storage that cannot be reached at all.
 *
 * Questions carry `X-Nucleus-LLM: fake` — with LLM_ALLOW_FAKE_HEADER=true the
 * deterministic, extractive answer comes back and no tokens are spent.
 * Serial, and the collection it makes is removed at the end.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(here, "fixtures", "knowledge", name);
const NAME = `E2E knowledge ${Date.now().toString(36)}`;

test.beforeEach(async ({ page }) => {
  await page.route("**/platform/api/knowledge/ask", (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-nucleus-llm": "fake" } }),
  );
});

async function openCollection(page: Page) {
  await page.goto("/ai/documents");
  await page.getByTestId("collection-list").getByText(NAME).click();
  await expect(page.getByTestId("collection-title")).toHaveText(NAME);
}

test("create a collection, upload a PDF, a DOCX and Markdown, and watch them be read", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/ai/documents");
  await page.getByTestId("collection-new").click();
  const modal = page.getByRole("dialog");
  await modal.getByTestId("collection-name").fill(NAME);
  await modal.getByPlaceholder("The handbook and the security policy").fill("Created by the e2e suite.");
  await modal.getByText("Only me").click();
  await modal.getByRole("button", { name: "Create collection" }).click();

  // A new collection opens on its documents, with the big drop zone.
  await expect(page.getByText("Drop the files people ask about")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([
    fixture("fleet-policy.pdf"),
    fixture("supplier-code.docx"),
    fixture("onboarding.md"),
  ]);
  await expect(page.getByTestId("document-row")).toHaveCount(3, { timeout: 60_000 });
  for (const name of ["fleet-policy.pdf", "supplier-code.docx", "onboarding.md"]) {
    const row = page.getByTestId("document-row").filter({ hasText: name });
    await expect(row).toHaveAttribute("data-status", "READY", { timeout: 180_000 });
  }
  const pdf = page.getByTestId("document-row").filter({ hasText: "fleet-policy.pdf" });
  await expect(pdf).toContainText(/\d+ pages?/);
  await expect(pdf).toContainText(/passages/);
});

test("ask a question and open a citation at its page", async ({ page }) => {
  test.setTimeout(120_000);
  await openCollection(page);
  await page.getByTestId("ask-input").fill("How often is every vehicle inspected?");
  await page.getByTestId("ask-send").click();
  const answer = page.getByTestId("answer").last();
  await expect(answer).toBeVisible({ timeout: 60_000 });
  const source = answer.getByTestId("answer-source").filter({ hasText: "fleet-policy.pdf" }).first();
  await expect(source).toContainText(/p\. \d+/);
  await source.click();
  await expect(page).toHaveURL(/passage=/);
  await expect(page.getByTestId("citation-pdf-page")).toContainText(/Page \d+ of \d+/, { timeout: 30_000 });
  await expect(page.getByTestId("citation-mark").first()).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect(page).not.toHaveURL(/passage=/);
});

test("a file too large, or of a kind that cannot be read, is refused before it is sent", async ({ page }) => {
  await openCollection(page);
  await page.getByTestId("collection-tabs").getByText(/^Documents/).click();
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/platform/api/files")) uploads.push(request.url());
  });
  await page.locator('input[type="file"]').setInputFiles([
    { name: "too-big.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(51 * 1024 * 1024, 32) },
    { name: "program.zip", mimeType: "application/zip", buffer: Buffer.from("PK") },
  ]);
  const items = page.getByTestId("upload-item");
  await expect(items).toHaveCount(2);
  await expect(items.filter({ hasText: "too-big.pdf" })).toContainText("over the 50 MB");
  await expect(items.filter({ hasText: "program.zip" })).toContainText(".zip file cannot be read");
  expect(uploads).toHaveLength(0);
});

test("storage that cannot be reached says so, and the upload can be retried", async ({ page }) => {
  await openCollection(page);
  await page.getByTestId("collection-tabs").getByText(/^Documents/).click();
  // Both legs blocked: the presigned PUT and the same-origin fallback.
  await page.route("**/nucleus/files/**", (route) => route.abort("connectionrefused"));
  await page.route("**/platform/api/files/*/content", (route) => route.abort("connectionrefused"));
  await page.locator('input[type="file"]').setInputFiles(fixture("onboarding.md"));
  const item = page.getByTestId("upload-item");
  await expect(item).toHaveAttribute("data-state", "error", { timeout: 30_000 });
  await expect(item).toContainText("could not reach storage");

  await page.unroute("**/nucleus/files/**");
  await page.unroute("**/platform/api/files/*/content");
  await item.getByTestId("upload-retry").click();
  await expect(page.getByTestId("upload-item")).toHaveCount(0, { timeout: 30_000 });
});

test("a blocked presigned PUT falls back to the API and still uploads", async ({ page }) => {
  await openCollection(page);
  await page.getByTestId("collection-tabs").getByText(/^Documents/).click();
  await page.route("**/nucleus/files/**", (route) => route.abort("accessdenied"));
  const before = await page.getByTestId("document-row").count();
  await page.locator('input[type="file"]').setInputFiles({
    name: "fallback.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Fallback\n\nSent through the API when storage refused the origin.\n"),
  });
  await expect(page.getByTestId("document-row")).toHaveCount(before + 1, { timeout: 30_000 });
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage({ storageState: ".auth/admin.json" });
  await page.goto("/ai/documents");
  const row = page.getByTestId("collection-list").getByText(NAME);
  if ((await row.count()) === 0) return;
  await row.click();
  await page.getByRole("button", { name: "Remove collection" }).click();
  await page.getByRole("button", { name: "Remove" }).click();
  await page.close();
});
