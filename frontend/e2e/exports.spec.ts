import AxeBuilder from "@axe-core/playwright";
import { expect, request, test } from "@playwright/test";

import { apiAs, namespaced } from "./api";
import { signIn, storageStateFor, type Persona } from "./auth";

/**
 * Exports against the real stack (§30).
 *
 * The claims a component test cannot make, and the reason each one needs the
 * whole stack:
 *
 * **A queued export produces a file that is really there.** The seeded exports
 * used to say `{"rows": 184203, "artifact": "exports/JOB-000004.csv"}` for
 * bytes nobody had written, with a `.csv` extension on a payload whose format
 * was `xlsx`. Only MinIO can say whether an installation's artefacts exist, and
 * only a real download can say whether the file parses.
 *
 * **The file is the question that was asked.** A filtered export is queued and
 * the produced rows are checked against the filter — an export that quietly
 * widened its query on the slow path would be the worst kind of wrong.
 *
 * **The row count is the file's.** Asserted against the bytes rather than
 * against the number the request hoped for.
 *
 * **Somebody else's export is not there.** Checked as an administrator against
 * an analyst's export, because that is the privilege boundary this feature
 * introduces and 404-not-403 is deliberate.
 *
 * Everything this spec creates, it discards — through the endpoint a person
 * uses, so the cleanup exercises the product rather than the database.
 */

test.describe.configure({ mode: "serial" });

/**
 * The analyst, throughout — because an export belongs to whoever asked for it.
 *
 * Not the project's default persona, and this is the reason: the default is the
 * administrator, and every page test here signed in as the analyst while the
 * browser carried the administrator's session. `signIn` then waited forty-five
 * seconds for a name that was never going to appear on a page that had
 * rendered perfectly. The analyst is also the interesting persona: it holds
 * `records.export` and nothing else that could paper over a missing check.
 */
test.use({ storageState: storageStateFor("analyst") });

/**
 * `/exports` lives beside `/notifications` rather than under `/api`, so it
 * takes `namespaced` — the same prefix the administration endpoints use.
 */
function url(path = ""): string {
  return namespaced(`/exports${path}`);
}

/**
 * Fetch a signed URL with no credentials at all.
 *
 * Deliberately not through `apiAs`: that context carries a bearer token on
 * every request, and S3 answers a presigned URL *plus* an `Authorization`
 * header with 400 — two authentication mechanisms for one request. Which is
 * also the claim worth making, so this helper is the assertion: a signed URL
 * needs nothing but itself, which is what lets the bytes bypass the API.
 */
async function fetchSigned(link: string) {
  const anonymous = await request.newContext();
  try {
    const response = await anonymous.get(link);
    return { status: response.status(), text: await response.text(), body: await response.body() };
  } finally {
    await anonymous.dispose();
  }
}

/** Queue an export as this persona and hand back the row. */
async function queue(
  persona: Persona,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const api = await apiAs(persona);
  const response = await api.post(url(), { data: body });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as Record<string, unknown>;
}

async function settle(
  persona: Persona,
  id: string,
  timeoutMs = 20_000,
): Promise<Record<string, unknown>> {
  const api = await apiAs(persona);
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    const response = await api.get(url(`/${id}`));
    last = (await response.json()) as Record<string, unknown>;
    // Polled rather than assumed instant: under gunicorn the work is a
    // greenlet, and a test that asserted on the response body would be
    // asserting on a race.
    if (!["QUEUED", "RUNNING", "RETRYING"].includes(String(last["status"]))) return last;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`export ${id} never finished: ${JSON.stringify(last)}`);
}

/**
 * Let an export go entirely.
 *
 * Twice, because `forget` takes two presses — the file, then the record — and
 * the same shape `sweepMailThreads` documents for threads. Pressing once left
 * a row behind per test, which is a ratchet: `/exports` filled up with every
 * run until `--check` started reporting them, which is how this was found.
 */
async function discard(persona: Persona, id: string): Promise<void> {
  const api = await apiAs(persona);
  await api.delete(url(`/${id}`));
  await api.delete(url(`/${id}`));
}

test("a queued export produces a file with the row count it reports", async () => {
  const made = await queue("analyst", { resource_type: "ticket", format: "csv" });
  const id = String(made["id"]);

  try {
    const done = await settle("analyst", id);
    expect(done["status"]).toBe("SUCCEEDED");
    expect(Number(done["rows"])).toBeGreaterThan(0);
    expect(done["downloadable"]).toBe(true);
    // Named for the platform, not for the queue: `EXP-` is what `/exports`
    // shows and what somebody quotes back.
    expect(String(done["reference"])).toMatch(/^EXP-\d{6}$/);

    const api = await apiAs("analyst");
    const link = await (await api.get(url(`/${id}/download`))).json();
    expect(link.expires_in).toBeGreaterThan(0);

    // Fetched from the signed URL, so this proves the bytes are in storage and
    // not merely that a row says so.
    const file = await fetchSigned(String(link.url));
    expect(file.status).toBe(200);
    const body = file.text;
    const lines = body.trim().split("\n").filter(Boolean);
    // Header plus one line per row — the count on the row is the count in the
    // file, because one was derived from the other.
    expect(lines.length).toBe(Number(done["rows"]) + 1);
    expect(Number(link.size_bytes)).toBe(Buffer.byteLength(body));
  } finally {
    await discard("analyst", id);
  }
});

test("the queued file is the question that was asked, not a wider one", async () => {
  const made = await queue("analyst", {
    resource_type: "ticket",
    format: "csv",
    filters: { status: "OPEN" },
    columns: ["reference", "status"],
  });
  const id = String(made["id"]);

  try {
    const done = await settle("analyst", id);
    const api = await apiAs("analyst");
    const link = await (await api.get(url(`/${id}/download`))).json();
    const body = (await fetchSigned(String(link.url))).text;

    const [header, ...rows] = body.trim().split("\n").filter(Boolean);
    // The columns asked for, in that order, labelled from the field catalogue.
    expect(header!.replace(/^\ufeff/, "")).toBe("Reference,Status");
    expect(rows.length).toBe(Number(done["rows"]));
    // Every produced row satisfies the filter. An export that widened its
    // query because it took the queued path would pass every other assertion
    // in this file.
    const statuses = new Set(rows.map((line) => line.split(",")[1]));
    expect([...statuses]).toEqual(["OPEN"]);
  } finally {
    await discard("analyst", id);
  }
});

test("a workbook is a workbook, not a CSV with a spreadsheet's name", async () => {
  const made = await queue("analyst", { resource_type: "ticket", format: "xlsx" });
  const id = String(made["id"]);

  try {
    const done = await settle("analyst", id);
    const api = await apiAs("analyst");
    const link = await (await api.get(url(`/${id}/download`))).json();
    const bytes = (await fetchSigned(String(link.url))).body;

    // A zip container, which is what an `.xlsx` is. The seeded exports named
    // every artefact `.csv` whatever their payload said, so this is the
    // assertion that would have caught it.
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(String(link.filename)).toMatch(/\.xlsx$/);
    expect(String(done["format"])).toBe("xlsx");
  } finally {
    await discard("analyst", id);
  }
});

test("no seeded export claims a file the installation does not have", async () => {
  // The defect this whole feature was built out of, asked of the running
  // installation rather than of a fixture.
  const api = await apiAs("admin");
  const listing = await (await api.get(url("?page_size=100"))).json();

  const lying: string[] = [];
  for (const row of listing.items as Array<Record<string, unknown>>) {
    if (!row["downloadable"]) continue;
    const link = await api.get(url(`/${String(row["id"])}/download`));
    if (link.status() !== 200) lying.push(String(row["reference"]));
  }
  expect(lying).toEqual([]);
});

test("every export on the page describes a query that can still be read", async () => {
  const api = await apiAs("admin");
  const listing = await (await api.get(url("?page_size=100"))).json();
  const unreadable = (listing.items as Array<Record<string, unknown>>)
    .filter((row) => String(row["description"]).includes("no longer exist"))
    .map((row) => row["reference"]);
  // The old payload named an `entity` no code could resolve, so not one seeded
  // export could describe itself.
  expect(unreadable).toEqual([]);
});

test("an administrator cannot fetch somebody else's export", async () => {
  const made = await queue("analyst", { resource_type: "ticket", format: "csv" });
  const id = String(made["id"]);

  try {
    await settle("analyst", id);
    const admin = await apiAs("admin");
    // 404 rather than 403: "that belongs to somebody else" is a way to confirm
    // a reference exists, and an administrator who needs the data can run the
    // query in their own name — which leaves an audit entry that a download of
    // this row would not.
    expect((await admin.get(url(`/${id}`))).status()).toBe(404);
    expect((await admin.get(url(`/${id}/download`))).status()).toBe(404);
  } finally {
    await discard("analyst", id);
  }
});

test("the ceilings the page prints are the ones the API enforces", async () => {
  const api = await apiAs("analyst");
  const catalogue = await (await api.get(url("/catalogue"))).json();
  const settings = await apiAs("admin");
  const limit = await (
    await settings.get(namespaced("/admin/settings?category=limits"))
  ).json();

  const row = (limit.groups as Array<{ items: Array<Record<string, unknown>> }>)
    .flatMap((group) => group.items)
    .find((entry) => entry["key"] === "limits.max_export_rows");
  expect(row, "limits.max_export_rows is not seeded").toBeTruthy();
  // The number an administrator edits is the number the export path applies.
  expect(catalogue.max_rows).toBe(Number(row!["value"]));
});

test("the page shows what is ready and lets it be discarded", async ({ page }) => {
  const made = await queue("analyst", { resource_type: "ticket", format: "csv" });
  const id = String(made["id"]);
  const reference = String((await settle("analyst", id))["reference"]);

  try {
    await signIn(page, "analyst", "/exports");
    await expect(page.getByTestId("exports-table")).toBeVisible();
    await expect(
      page.getByTestId("exports-table").locator("tbody tr[data-row-key]").first(),
    ).toBeVisible();

    await expect(page.getByTestId(`download-${reference}`)).toBeVisible();

    await page.getByTestId(`discard-${reference}`).click();
    await page.getByRole("button", { name: "Discard the file" }).click();

    // The file goes and the row stays, so the two presses are visibly
    // different acts rather than one delete that needed confirming twice.
    await expect(page.getByTestId(`download-${reference}`)).toHaveCount(0);
    await expect(page.getByTestId(`exp-${reference}`)).toBeVisible();
    await expect(page.getByTestId(`again-${reference}`)).toBeVisible();

    // And the second press takes the record, with the copy saying where the
    // history went.
    await page.getByTestId(`discard-${reference}`).click();
    await expect(page.getByText(/stays in the audit trail/)).toBeVisible();
    await page.getByRole("button", { name: "Remove it" }).click();
    await expect(page.getByTestId(`exp-${reference}`)).toHaveCount(0);
  } finally {
    await discard("analyst", id);
  }
});

test("the drawer counts the rows before it offers a button", async ({ page }) => {
  await signIn(page, "analyst", "/exports");
  await expect(page.getByTestId("exports-table")).toBeVisible();

  await page.getByTestId("new-export").click();
  const estimate = page.getByTestId("estimate");
  await expect(estimate).toBeVisible();
  // A real count from a real dataset, which is the fact that chooses between
  // the immediate download and the background export.
  await expect(estimate).toContainText(/\d+ rows/);
  await expect(page.getByTestId("limits")).toContainText("50,000");
});

test("an export queued from the drawer appears with its file", async ({ page }) => {
  await signIn(page, "analyst", "/exports");
  await expect(page.getByTestId("exports-table")).toBeVisible();

  await page.getByTestId("new-export").click();
  await expect(page.getByTestId("estimate")).toBeVisible();
  await page.getByTestId("queue-export").click();

  // Opened straight away, because the file is what somebody wants next.
  const detail = page.getByTestId("export-detail");
  await expect(detail).toBeVisible();

  // Taken from the URL rather than by name: an earlier run's row would match a
  // name prefix, and this spec has been bitten by that before.
  const id = new URL(page.url()).searchParams.get("export") ?? "";
  expect(id).not.toBe("");

  try {
    const done = await settle("analyst", id);
    expect(done["status"]).toBe("SUCCEEDED");
    await page.reload();
    await expect(
      page.getByTestId(`download-${String(done["reference"])}`),
    ).toBeVisible();
  } finally {
    await discard("analyst", id);
  }
});

test.describe("a role without the export privilege", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("is offered no page and refused by the API", async ({ page }) => {
    await signIn(page, "viewer", "/exports");
    await expect(page.getByTestId("exports-table")).toHaveCount(0);

    const api = await apiAs("viewer");
    expect((await api.get(url())).status()).toBe(403);
  });
});

test("the page is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "analyst", "/exports");
  await expect(page.getByTestId("exports-table")).toBeVisible();
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
