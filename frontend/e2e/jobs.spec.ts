import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { apiAs, findRetryableJob, namespaced } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * The background job queue against the real stack (§23).
 *
 * The claims a component test cannot make:
 *
 * **A retry is the same row in PostgreSQL.** A fixture can be made to say
 * anything; only the real service proves that `attempt` went up on the job
 * that was already there rather than a second row appearing beside it — which
 * is what keeps "attempt 3 of 3" a fact and stops one failure being counted
 * three times.
 *
 * **The refusals are the server's.** The page disables a Retry it believes is
 * impossible; these tests check the endpoint refuses it too, with the state or
 * the bound named. A gate enforced only in the browser is not a gate.
 *
 * **Every status the strip offers has something in it**, which is a claim
 * about the seed and its repair rather than about the page.
 *
 * And that an analyst — `jobs.view` without `jobs.manage` — can watch the
 * queue and cannot touch it.
 */

test.describe.configure({ mode: "serial" });

/** The table's real rows: AntD's empty state is a `tbody tr` too. */
function rows(page: import("@playwright/test").Page) {
  return page.getByTestId("jobs-table").locator("tbody tr[data-row-key]");
}

/**
 * Press a confirmation, once its popover has stopped moving.
 *
 * AntD's Popconfirm zooms in, and Playwright refuses to click a target it
 * considers unstable — "element is not stable", after sixty seconds of
 * retrying. Waiting for the animations rather than sleeping is the same
 * approach the accessibility checks here already take.
 */
async function confirm(page: import("@playwright/test").Page, label: string) {
  const button = page.getByRole("button", { name: label, exact: true });
  await expect(button).toBeVisible();
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
  await button.click();
}

test("the queue lists what the platform has run", async ({ page }) => {
  await signIn(page, "admin", "/admin/jobs");
  await expect(page.getByTestId("jobs-table")).toBeVisible();
  await expect(rows(page).first()).toBeVisible();

  const strip = page.getByTestId("job-statuses");
  await expect(strip).toBeVisible();
  for (const status of ["QUEUED", "RUNNING", "RETRYING", "SUCCEEDED", "FAILED", "CANCELLED"]) {
    await expect(page.getByTestId(`job-status-${status}`)).toBeVisible();
  }
});

test("every status the strip offers has a job in it", async ({ page }) => {
  await signIn(page, "admin", "/admin/jobs");
  await expect(page.getByTestId("job-statuses")).toBeVisible();

  // A claim about the seed, not the page: RETRYING is weighted at 0.04, so at
  // the small scale the draw leaves it empty about half the time and the
  // console ends up offering a filter that can never match anything (§76).
  // `--sync-jobs` is the repair; this is what says it was needed.
  for (const status of ["QUEUED", "RUNNING", "RETRYING", "SUCCEEDED", "FAILED", "CANCELLED"]) {
    await expect(
      page.getByTestId(`job-status-${status}`),
      `no job is ${status} — run 'make sync-jobs'`,
    ).toBeEnabled();
  }
});

test("a retrying job says why it is retrying, not merely that it is", async ({ page }) => {
  await signIn(page, "admin", "/admin/jobs?status=RETRYING");
  await expect(rows(page).first()).toBeVisible();
  await rows(page).first().click();

  // The one distinction this screen exists for: failed and being handled,
  // versus failed and finished.
  await expect(page.getByTestId("job-error")).toContainText("will be tried again");
});

test("a retry is the same job with the next attempt, in the database", async ({ page }) => {
  // A *cancelled* job rather than a failed one, and put back afterwards. Both
  // halves matter: CANCELLED is terminal, so it is retryable, and cancelling
  // it again restores the status — which keeps this spec from being a ratchet
  // on the seeded data. A version that retried a FAILED job left one fewer
  // failure behind on every run, and the suite eventually failed for want of
  // one. (`attempt` still climbs, which `--sync-jobs` tops up.)
  // Which job, asked of the API rather than taken off the console's first
  // page. A retry spends an attempt irreversibly, so retryable rows drain
  // with use — and the ones `--sync-jobs` adds carry seed-relative
  // timestamps, so they sort into the middle of a thirty-row status filter.
  // This spec used to fail on its own guard while three good candidates sat
  // on page two.
  const candidate = await findRetryableJob("CANCELLED");
  expect(
    candidate,
    "no cancelled job is within its attempts — run 'make sync-jobs'",
  ).not.toBeNull();
  const reference = candidate!.reference;

  // Filtered to that one, which is also how an operator reaches a job they
  // have a reference for.
  await signIn(page, "admin", `/admin/jobs?status=CANCELLED&q=${reference}`);
  await expect(rows(page).first()).toBeVisible();
  const retryable = page.locator(`[data-testid="retry-${reference}"]:not([disabled])`);
  await expect(retryable).toBeVisible();
  // The attempt *before*, read from the server. Asserted relatively rather
  // than as "attempt 2": these rows are shared with every other run, and a
  // job already on its second attempt made the absolute form fail — the claim
  // was always "the next attempt", not a particular number.
  const api = await apiAs("admin");
  const idOf = async () => {
    const listed = await (
      await api.get(namespaced(`/admin/jobs?q=${reference}&page_size=1`))
    ).json();
    return listed.items[0] as { id: string; attempt: number; status: string };
  };
  const before = await idOf();

  await retryable.first().click();
  // `exact` because Playwright matches an accessible name as a *substring* by
  // default, so "Retry" also finds every "Retry JOB-000011" button and the
  // "retrying" status chip. The component test needs no such flag —
  // testing-library's `name` is exact — which is a difference worth knowing
  // when the same assertion is written in both.
  await confirm(page, "Retry");
  await expect(page.getByText(/is queued again/)).toBeVisible();

  // Read back from the server: the same job, queued, on a later attempt — and
  // exactly one row for it, because a retry must not fork into a second job.
  await page.goto(`/admin/jobs?q=${reference}`);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("jobs-table")).toContainText("queued");

  const after = await idOf();
  expect(after.id, "a retry forked into a second job").toBe(before.id);
  expect(after.attempt).toBe(before.attempt + 1);
  expect(after.status).toBe("QUEUED");

  // Put the *status* back, so the next run finds the same queue shape.
  //
  // The attempt it spent is not put back, and deliberately not: `attempt` is a
  // record of what happened, and no endpoint rewrites it — which is the right
  // call for the product and leaves this spec spending one attempt of headroom
  // per run. Granting attempts back instead was tried and only traded the
  // drift for `max_attempts` climbing towards its ceiling. So the contract is
  // the one `--sync-mailboxes` already sets for the mailbox drain: `sync_jobs`
  // guarantees at least one *retryable* job per status, the guard above names
  // it, and one command repairs a demo that has been run dry.
  await page.getByTestId(`cancel-${reference}`).click();
  await confirm(page, "Stop the job");
  await expect(page.getByText(/was stopped/)).toBeVisible();
  await page.goto(`/admin/jobs?q=${reference}`);
  await expect(page.getByTestId("jobs-table")).toContainText("cancelled");
});

test("a spent job is offered the grant the refusal points at", async ({ page }) => {
  // The pair this page turns on: a job with no attempts left is refused a
  // retry *and* offered more attempts, which is the fix the refusal names.
  // Before there was a grant, the message told an operator to raise a limit
  // the product gave them no way to raise.
  const api = await apiAs("admin");
  const listed = await (
    await api.get(namespaced("/admin/jobs?status=FAILED&page_size=50"))
  ).json();
  const spent = (listed.items as Array<{ reference: string; can_allow_attempts: boolean }>).find(
    (job) => job.can_allow_attempts,
  );

  if (!spent) {
    // Nothing has exhausted its attempts, which is a healthy queue rather than
    // a broken test — the refusal itself is asserted in the backend suite.
    test.skip(true, "no job has spent its attempts");
    return;
  }

  await signIn(page, "admin", `/admin/jobs?q=${spent.reference}`);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId(`retry-${spent.reference}`)).toBeDisabled();
  await expect(page.getByTestId(`grant-${spent.reference}`)).toBeEnabled();
});

test("the server refuses a retry the page would not offer", async ({ page }) => {
  await signIn(page, "admin", "/admin/jobs?status=RUNNING");
  await expect(rows(page).first()).toBeVisible();

  // The page disables it, in the row and in the drawer…
  await expect(page.locator('[data-testid^="retry-JOB-"][disabled]').first()).toBeVisible();
  const id = await rows(page).first().getAttribute("data-row-key");
  await rows(page).first().click();
  await expect(page.getByTestId("detail-retry")).toBeDisabled();

  // …and so does the endpoint, which is the half that matters: a gate enforced
  // only in the browser is not a gate.
  const api = await apiAs("admin");
  // `namespaced`, not `endpoint`: the administration routes live at
  // `/platform/admin/…` and not under `/platform/api`.
  const answer = await api.post(namespaced(`/admin/jobs/${id}/retry`));
  expect(answer.status()).toBe(409);
  expect((await answer.json()).message).toContain("twice");
});

test("cancelling keeps the row, marked cancelled", async ({ page }) => {
  // The target is chosen through the API, not by taking the first row: this
  // test cancels a job and then retries it back, and a queued job that has
  // already used its attempts can be cancelled and *not* retried — so picking
  // by position eventually lands on one it cannot restore. The table does not
  // show an attempt count of 1, so the row alone cannot say which is which.
  const api = await apiAs("admin");
  const queued = await (
    await api.get(namespaced("/admin/jobs?status=QUEUED&page_size=50"))
  ).json();
  const target = (queued.items as Array<{ reference: string; attempt: number; max_attempts: number }>)
    .find((job) => job.attempt < job.max_attempts);
  expect(
    target,
    "no queued job is within its attempts — run 'make sync-jobs'",
  ).toBeDefined();
  const reference = target!.reference;

  await signIn(page, "admin", `/admin/jobs?q=${reference}`);
  await expect(rows(page)).toHaveCount(1);

  await page.getByTestId(`cancel-${reference}`).click();
  await confirm(page, "Stop the job");
  await expect(page.getByText(/was stopped/)).toBeVisible();

  // Still there — a queue whose cancelled jobs vanish cannot answer "why did
  // the nightly export not run last Tuesday".
  await page.goto(`/admin/jobs?q=${reference}`);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByTestId("jobs-table")).toContainText("cancelled");

  // And back to queued, so the queue this spec found is the queue it leaves.
  await page.getByTestId(`retry-${reference}`).click();
  await confirm(page, "Retry");
  await expect(page.getByText(/is queued again/)).toBeVisible();
});

test("a job opens onto what it was asked to do and what it said", async ({ page }) => {
  await signIn(page, "admin", "/admin/jobs?status=SUCCEEDED");
  await expect(rows(page).first()).toBeVisible();
  await rows(page).first().click();

  await expect(page.getByTestId("job-payload")).toBeVisible();
  await expect(page.getByTestId("job-lines")).toBeVisible();
  // A job that worked has a result and no error.
  await expect(page.getByTestId("job-result")).toBeVisible();
  await expect(page.getByTestId("job-error")).toHaveCount(0);
});

test.describe("what an analyst is offered", () => {
  test.use({ storageState: storageStateFor("analyst") });

  test("the queue to watch, and nothing to press", async ({ page }) => {
    // `jobs.view` without `jobs.manage`: watching a queue and re-running work
    // against real records are different privileges.
    await signIn(page, "analyst", "/admin/jobs");
    await expect(page.getByTestId("jobs-table")).toBeVisible();

    // Said once at the top rather than as a column of disabled buttons — the
    // reason is a permission, and it will not change while they look at it.
    await expect(page.getByTestId("read-only")).toBeVisible();
    await expect(page.locator('[data-testid^="retry-JOB-"]')).toHaveCount(0);
  });
});

test.describe("what a viewer is offered", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("nothing at all", async ({ page }) => {
    await signIn(page, "viewer", "/admin/jobs");
    await expect(page.getByTestId("jobs-table")).toHaveCount(0);
  });
});

test("the queue is legible and keyboard-reachable", async ({ page }) => {
  for (const path of ["/admin/jobs", "/admin/jobs?status=FAILED"]) {
    await signIn(page, "admin", path);
    await expect(page.getByTestId("jobs-table")).toBeVisible();
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );

    const audit = await new AxeBuilder({ page }).include("#nu-main").analyze();
    const serious = audit.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(
      serious.map((violation) => ({
        path,
        id: violation.id,
        nodes: violation.nodes.map(
          (node) => `${node.target.join(" ")} :: ${node.failureSummary}`,
        ),
      })),
    ).toEqual([]);
  }
});
