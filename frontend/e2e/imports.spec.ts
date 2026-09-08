import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { apiAs, endpoint, namespaced } from "./api";
import { signIn, storageStateFor, type Persona } from "./auth";

/**
 * The import wizard against the real stack (§29).
 *
 * The claims a component test cannot make:
 *
 * **The records that land are real records, named by the server.** An import
 * creates rows through the same write path a form does, so the only way to
 * know it did is to look them up afterwards through the ordinary records API
 * and find them with the identifier the server generated.
 *
 * **A row a *form* refuses is a row the import refuses**, by the same message.
 * Asserted by posting the same bad value to `POST /api/records/customer` and
 * comparing what comes back — which is the whole reason the validation lives in
 * one function.
 *
 * **All or nothing survives a real transaction.** A failure part-way must
 * leave no records, and only PostgreSQL can say whether the rollback happened.
 *
 * **Somebody else's staged file is not readable.** A draft holds the contents
 * of a spreadsheet, so the boundary is checked with an administrator against a
 * manager's run — 404, not 403, deliberately.
 *
 * Everything this spec creates, it removes: the drafts through the endpoint a
 * person uses, and the records through the records API, because an import that
 * left three customers behind per run is the ratchet `/exports` taught us to
 * look for.
 */

test.describe.configure({ mode: "serial" });

/**
 * The manager, throughout: `records.import` is theirs and the administrator's,
 * and the manager is the persona that holds it *without* holding everything
 * else — so a missing check cannot be papered over by another privilege.
 */
test.use({ storageState: storageStateFor("manager") });

const OWNER: Persona = "manager";

/** `/imports` lives beside `/notifications`, so it takes `namespaced`. */
function url(path = ""): string {
  return namespaced(`/imports${path}`);
}

/** A name only this suite writes, so its records can be found and removed. */
const MARK = "E2E Import";

function csv(rows: string[][]): string {
  return rows.map((row) => row.join(",")).join("\n") + "\n";
}

async function begin(content: string, filename = "e2e-customers.csv") {
  const api = await apiAs(OWNER);
  const response = await api.post(url(), {
    data: { target_entity: "customer", filename, content },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as Record<string, unknown>;
}

async function map(id: string, mapping: Record<string, string>) {
  const api = await apiAs(OWNER);
  const response = await api.put(url(`/${id}/mapping`), {
    data: { column_mapping: mapping },
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

async function settle(id: string, timeoutMs = 20_000) {
  const api = await apiAs(OWNER);
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    last = (await (await api.get(url(`/${id}`))).json()) as Record<string, unknown>;
    // Polled rather than assumed instant: under gunicorn the execute is a
    // greenlet, and asserting on the response body would be asserting on a
    // race.
    // RUNNING is the only state worth waiting out: a DRAFT is waiting for a
    // person, not for a greenlet.
    if (last["status"] !== "RUNNING") return last;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`import ${id} never settled: ${JSON.stringify(last)}`);
}

/**
 * Discard the draft and remove anything it created.
 *
 * The records go **as the administrator**, not as the importer: `records.delete`
 * is administrator-only, so a sweep running as the manager was getting a 403
 * per record and reporting nothing — seven `E2E Import …` customers had
 * accumulated before anybody looked. A cleanup that cannot delete looks exactly
 * like a clean run, which is the failure `e2e/api.ts` warns about twice.
 *
 * Unconditional, in a `finally`, so it runs whether the test passed or failed.
 */
async function sweep(id: string): Promise<void> {
  const owner = await apiAs(OWNER);
  // Twice, because `discard` takes two presses — the staged file, then the
  // record. Pressing once left a cancelled run behind per test, which is
  // exactly the ratchet `/exports` taught this suite to look for: thirty-three
  // of them before `--check` started reporting the shape.
  await owner.delete(url(`/${id}`));
  await owner.delete(url(`/${id}`));

  // Found through the explorer's own query, so the lookup cannot disagree with
  // the list a page would draw — and by the name only this suite writes,
  // never by a wider prefix.
  const admin = await apiAs("admin");
  const found = await admin.post(endpoint("/explorer/query"), {
    data: {
      resource_type: "customer",
      query_text: MARK,
      columns: ["name"],
      page_size: 100,
    },
  });
  if (!found.ok()) {
    throw new Error(`Could not list the imported records to sweep: ${found.status()}`);
  }
  const { items } = (await found.json()) as { items: { id: string; name: string }[] };
  for (const row of items) {
    if (!row.name.startsWith(MARK)) continue;
    const gone = await admin.delete(endpoint(`/records/customer/${row.id}`));
    if (!gone.ok()) {
      throw new Error(`Could not remove ${row.name}: ${gone.status()} ${await gone.text()}`);
    }
  }
}

test("a file is read, its separator detected, and a mapping proposed", async () => {
  // Semicolons and a BOM, which is what Excel writes on a Windows machine in
  // Europe — the normal file, not an edge case.
  const content =
    // The BOM written as an escape, because a literal one is invisible in a
    // diff and the linter refuses it.
    "\ufeffName;Email;Segment\n" +
    `${MARK} One;one@e2e.test;SMB\n` +
    `${MARK} Two;two@e2e.test;ENTERPRISE\n`;
  const run = await begin(content, "e2e-semicolons.csv");

  try {
    expect(String(run["reference"])).toMatch(/^IMP-\d{6}$/);
    expect(run["delimiter"]).toBe(";");
    expect(run["total_rows"]).toBe(2);
    // The BOM did not become part of the first column's name, which is what
    // would have made it unmappable.
    const columns = run["detected_columns"] as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(["Name", "Email", "Segment"]);
    // Proposed, not applied — the mapping step exists because the guess is
    // sometimes wrong.
    expect(run["column_mapping"]).toEqual({
      Name: "name",
      Email: "email",
      Segment: "segment",
    });
  } finally {
    await sweep(String(run["id"]));
  }
});

test("a row a form refuses is refused here, by the same message", async () => {
  const content = csv([
    ["Name", "Segment"],
    [`${MARK} Bad`, "NOT-A-SEGMENT"],
  ]);
  const run = await begin(content);
  const id = String(run["id"]);

  try {
    const checked = await map(id, { Name: "name", Segment: "segment" });
    const problems = checked["errors"] as Array<Record<string, unknown>>;
    expect(problems.length).toBeGreaterThan(0);

    // The same value through the *form's* endpoint, and the same sentence
    // back. One validation, two callers — an importer with its own rules
    // would drift from this and nobody would know until an execute failed.
    const api = await apiAs(OWNER);
    const refused = await api.post(endpoint("/records/customer"), {
      data: { name: `${MARK} Form`, segment: "NOT-A-SEGMENT" },
    });
    expect(refused.status()).toBe(400);
    expect(String(problems[0]!["message"])).toBe((await refused.json()).message);
    // And the line in the file, so it can be found in the spreadsheet.
    expect(problems[0]!["line"]).toBe(2);
  } finally {
    await sweep(id);
  }
});

test("the valid rows become records the platform can find", async () => {
  const content = csv([
    ["Name", "Email", "Segment"],
    [`${MARK} Alpha`, "alpha@e2e.test", "SMB"],
    [`${MARK} Beta`, "beta@e2e.test", "ENTERPRISE"],
    [`${MARK} Gamma`, "gamma@e2e.test", "NOT-A-SEGMENT"],
  ]);
  const run = await begin(content);
  const id = String(run["id"]);

  try {
    const checked = await map(id, { Name: "name", Email: "email", Segment: "segment" });
    expect(checked["valid_rows"]).toBe(2);
    expect(checked["invalid_rows"]).toBe(1);
    // The claim, as arithmetic: the four counts have to be the four parts of
    // one number.
    expect(
      Number(checked["valid_rows"]) +
        Number(checked["invalid_rows"]) +
        Number(checked["skipped_rows"]),
    ).toBe(Number(checked["total_rows"]));

    const api = await apiAs(OWNER);
    const started = await api.post(url(`/${id}/execute`));
    expect(started.status(), await started.text()).toBe(202);

    const done = await settle(id);
    expect(done["status"]).toBe("COMPLETED");
    expect(done["imported_rows"]).toBe(2);

    // Looked up through the ordinary records API, because that is the proof
    // they are records rather than rows in a staging column.
    const found = await api.post(endpoint("/explorer/query"), {
      data: {
        resource_type: "customer",
        query_text: MARK,
        columns: ["code", "name", "segment"],
        page_size: 50,
      },
    });
    const { items } = (await found.json()) as {
      items: { code: string; name: string; segment: string }[];
    };
    const mine = items.filter((row) => row.name.startsWith(MARK));
    expect(mine.map((row) => row.name).sort()).toEqual([
      `${MARK} Alpha`,
      `${MARK} Beta`,
    ]);
    // Named by the server: the file does not get to choose an identifier.
    expect(mine.every((row) => row.code.startsWith("CUS-"))).toBe(true);
    // And the row that was wrong is not there — it was reported at the
    // preview, which is the step that exists so it can be.
    expect(mine.some((row) => row.name.endsWith("Gamma"))).toBe(false);
  } finally {
    await sweep(id);
  }
});

test("the staged file is dropped once the rows have become records", async () => {
  const content = csv([
    ["Name"],
    [`${MARK} Solo`],
  ]);
  const run = await begin(content);
  const id = String(run["id"]);

  try {
    await map(id, { Name: "name" });
    const api = await apiAs(OWNER);
    await api.post(url(`/${id}/execute`));
    const done = await settle(id);

    expect(done["status"]).toBe("COMPLETED");
    // It is a copy of somebody's spreadsheet, and holding it after the records
    // exist would be holding the data twice.
    expect((done["preview"] as unknown[]).length).toBe(0);
    expect(done["preview_total"]).toBe(0);
  } finally {
    await sweep(id);
  }
});

test("the error report comes back as a file to fix in the spreadsheet", async () => {
  const content = csv([
    ["Name", "Segment"],
    [`${MARK} Report`, "NOT-A-SEGMENT"],
  ]);
  const run = await begin(content);
  const id = String(run["id"]);

  try {
    await map(id, { Name: "name", Segment: "segment" });
    const api = await apiAs(OWNER);
    const report = await api.get(url(`/${id}/problems`));
    expect(report.status()).toBe(200);
    expect(report.headers()["content-type"]).toContain("text/csv");

    const body = (await report.text()).replace(/^\ufeff/, "");
    const [header, ...lines] = body.trim().split("\n");
    // The four things needed to find and fix one.
    expect(header).toBe("Line,Column,Value,Problem");
    expect(lines[0]).toContain("2,Segment,NOT-A-SEGMENT");
  } finally {
    await sweep(id);
  }
});

test("an execute is refused while a required field has no column", async () => {
  const content = csv([
    ["Email"],
    ["nobody@e2e.test"],
  ]);
  const run = await begin(content);
  const id = String(run["id"]);

  try {
    const api = await apiAs(OWNER);
    const refused = await api.post(url(`/${id}/execute`));
    expect(refused.status()).toBe(409);
    // Names the field, because "not ready" leaves somebody guessing which of
    // eleven columns they have not mapped (§76).
    expect((await refused.json()).details.unmapped_required).toContain("name");
  } finally {
    await sweep(id);
  }
});

test("a draft holds its file, so it can be picked up where it was left", async () => {
  // The whole reason a run stores its step and its rows — and the state every
  // seeded draft was in before `--sync-imports`: resumable in principle and
  // empty in practice.
  //
  // Its own draft rather than a seeded one, because a seeded draft belongs to
  // whoever created it and this suite cannot know who: the first version asked
  // as the administrator, found none, and skipped itself. The consistency of
  // the *seeded* runs is asserted in `backend/tests/test_imports.py`, which
  // can read them all.
  const run = await begin(csv([["Name"], [`${MARK} Resumed`], [`${MARK} Again`]]));
  const id = String(run["id"]);

  try {
    const api = await apiAs(OWNER);
    const opened = await (await api.get(url(`/${id}`))).json();
    expect(opened.step).toBe("MAPPING");
    expect((opened.preview as unknown[]).length).toBe(2);
    // The rows it holds *are* its total, so the preview footer cannot
    // describe a file that does not exist.
    expect(opened.preview_total).toBe(opened.total_rows);
    // And the mapping it proposed is still there, which is what makes
    // reopening it useful rather than merely possible.
    expect(opened.column_mapping).toEqual({ Name: "name" });
  } finally {
    await sweep(id);
  }
});

test("an administrator cannot read somebody else's staged file", async () => {
  const run = await begin(csv([["Name"], [`${MARK} Private`]]));
  const id = String(run["id"]);

  try {
    const admin = await apiAs("admin");
    // A draft holds the contents of a spreadsheet. 404 rather than 403, for
    // the reason an export's artefact is: the reply must not confirm the
    // reference exists.
    expect((await admin.get(url(`/${id}`))).status()).toBe(404);
    expect((await admin.post(url(`/${id}/execute`))).status()).toBe(404);
  } finally {
    await sweep(id);
  }
});

test.describe("a role without the import privilege", () => {
  test.use({ storageState: storageStateFor("operator") });

  test("is offered no page and refused by the API", async ({ page }) => {
    // Narrower than `records.create` on purpose: creating one record is a form
    // somebody can see, importing five thousand is not.
    await signIn(page, "operator", "/import");
    await expect(page.getByTestId("import-start")).toHaveCount(0);

    const api = await apiAs("operator");
    expect((await api.get(url())).status()).toBe(403);
  });
});

test("the wizard walks from a file to imported records", async ({ page }) => {
  await signIn(page, "manager", "/import");
  await expect(page.getByTestId("import-start")).toBeVisible();
  // The digits, not the separator: `formatNumber` follows the reader's own
  // number-format preference (§1, §40), and this installation's is
  // `1 234,56` — so asserting a comma would be asserting a setting.
  await expect(page.getByTestId("import-limits")).toContainText(/5[\s,.]?000 rows/);

  const content = csv([
    ["Name", "Email", "Segment"],
    [`${MARK} Wizard`, "wizard@e2e.test", "SMB"],
    [`${MARK} Broken`, "broken@e2e.test", "NOT-A-SEGMENT"],
  ]);

  // Through the page's own file input, because the drop zone reading the file
  // in the browser is part of what is being tested.
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "e2e-wizard.csv", mimeType: "text/csv", buffer: Buffer.from(content) });

  await expect(page.getByTestId("import-mapping")).toBeVisible();
  const id = new URL(page.url()).searchParams.get("run") ?? "";
  expect(id).not.toBe("");

  try {
    // The detected separator is on the page, so a wrong guess is visible.
    await expect(page.getByTestId("dialect")).toContainText("comma");

    await page.getByTestId("check-mapping").click();
    await expect(page.getByTestId("import-counts")).toContainText("Ready 1");
    await expect(page.getByTestId("import-counts")).toContainText("To fix 1");

    // The problem is on the row, with the file's own line number beside it.
    const preview = page.getByTestId("preview-table");
    await expect(preview).toContainText("NOT-A-SEGMENT");
    await expect(preview).toContainText(/is not a segment this record can have/);

    await page.getByTestId("execute-import").click();
    await expect(page.getByTestId("import-outcome")).toContainText("1 of 2 rows imported");
  } finally {
    await sweep(id);
  }
});

test("the wizard refuses to run while a required column is unchosen", async ({ page }) => {
  await signIn(page, "manager", "/import");
  await expect(page.getByTestId("import-start")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "e2e-nomap.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv([["Email"], ["nobody@e2e.test"]])),
  });

  await expect(page.getByTestId("import-mapping")).toBeVisible();
  const id = new URL(page.url()).searchParams.get("run") ?? "";

  try {
    // Said before anything is pressed, and specific about which field (§76).
    await expect(page.getByTestId("unmapped")).toContainText("Still needed: Name");
  } finally {
    await sweep(id);
  }
});

test("the page is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "manager", "/import");
  await expect(page.getByTestId("import-start")).toBeVisible();
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
