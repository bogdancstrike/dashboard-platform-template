import AxeBuilder from "@axe-core/playwright";
import { expect, request, test } from "@playwright/test";

import { apiAs, namespaced } from "./api";
import { PERSONAS, signIn, storageStateFor } from "./auth";

/**
 * The reader's own security page against the real stack (§41).
 *
 * The claim only the whole stack can make, and the one this feature exists
 * for: **revoking a session actually revokes it.** `UserSession`'s docstring
 * had said since it was written that a revoked session is refused on its next
 * request, and nothing read the table at all — so the page would have offered
 * a "sign out this device" button that left the device signed in. That is
 * worse than offering nothing, because a control that does nothing is one
 * people rely on.
 *
 * A component test cannot show it: it needs a real token, a real Keycloak
 * sign-in behind it, and a real request afterwards with the *same* token. So
 * this spec takes a direct grant of its own, uses it, revokes the session it
 * belongs to, and asks again.
 *
 * Plus: that the session the browser is using appears on the page at all —
 * which requires `core/auth` to have recorded it — and that no permission
 * gates any of this, checked with the persona holding the least.
 */

test.describe.configure({ mode: "serial" });

/** `/security` lives beside `/notifications`, so it takes `namespaced`. */
function url(path = ""): string {
  return namespaced(`/security${path}`);
}

const KEYCLOAK = process.env["KEYCLOAK_URL"] ?? "http://localhost:8080";

/**
 * A token of this spec's own, and the session id inside it.
 *
 * Deliberately not `apiAs`, which caches one token per persona for the whole
 * worker: revoking that session would sign every other spec's sweep out of
 * the same account. A fresh direct grant is its own session, so revoking it
 * damages nothing else.
 */
async function freshToken(persona: keyof typeof PERSONAS) {
  const account = PERSONAS[persona];
  const context = await request.newContext();
  try {
    const response = await context.post(
      `${KEYCLOAK}/realms/template/protocol/openid-connect/token`,
      {
        form: {
          client_id: "template-spa",
          grant_type: "password",
          username: account.username,
          password: account.password,
        },
      },
    );
    expect(response.ok(), `Keycloak refused a direct grant: ${response.status()}`).toBe(true);
    const token = ((await response.json()) as { access_token: string }).access_token;
    // The session id is a claim in the token, and it is what a revocation is
    // checked against — so the test reads it rather than guessing.
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
    ) as { sid?: string };
    return { token, sid: String(claims.sid ?? "") };
  } finally {
    await context.dispose();
  }
}

/** A caller carrying exactly that token and nothing cached. */
async function callerFor(token: string) {
  return request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

test("revoking a session refuses its next request", async () => {
  const { token, sid } = await freshToken("operator");
  expect(sid, "the realm issued a token with no session id").not.toBe("");
  const caller = await callerFor(token);

  try {
    // Using it records it, which is the other half of the design: without
    // that the page lists the seeded sessions and never the one the reader is
    // looking at it from.
    const listing = await (await caller.get(url("/sessions"))).json();
    expect(listing.current_known).toBe(true);
    const mine = (listing.items as Array<Record<string, unknown>>).find(
      (row) => row["current"] === true,
    );
    expect(mine, "this request's own session is not on the page").toBeTruthy();
    expect(mine!["state"]).toBe("ACTIVE");
    expect(mine!["can_revoke"]).toBe(true);

    const gone = await caller.delete(url(`/sessions/${String(mine!["id"])}`));
    expect(gone.status()).toBe(200);
    expect((await gone.json()).state).toBe("REVOKED");

    // The same token, still cryptographically valid — what makes it
    // unacceptable is the row. This assertion is the whole feature.
    const after = await caller.get(url("/sessions"));
    expect(after.status()).toBe(401);
    expect((await after.json()).message).toContain("signed out");

    // And it is refused *everywhere*, not only on this page: the check runs
    // before a permission is consulted.
    expect((await caller.get(namespaced("/api/me"))).status()).toBe(401);
    expect((await caller.get(namespaced("/notifications"))).status()).toBe(401);
  } finally {
    await caller.dispose();
  }
});

test("signing out everywhere else keeps the session that asked", async () => {
  // Two sessions on one account, which is the situation the sweep exists for.
  const other = await freshToken("operator");
  const mine = await freshToken("operator");
  const otherCaller = await callerFor(other.token);
  const myCaller = await callerFor(mine.token);

  try {
    // Both used, so both are recorded.
    expect((await otherCaller.get(url("/sessions"))).status()).toBe(200);
    expect((await myCaller.get(url("/sessions"))).status()).toBe(200);

    const swept = await myCaller.post(url("/sessions/revoke-others"));
    expect(swept.status()).toBe(200);
    expect((await swept.json()).revoked).toBeGreaterThanOrEqual(1);

    // This one still answers — an operation that signed you out too would
    // make its own result impossible to look at.
    expect((await myCaller.get(url("/sessions"))).status()).toBe(200);
    // And the other one does not.
    expect((await otherCaller.get(url("/sessions"))).status()).toBe(401);
  } finally {
    await otherCaller.dispose();
    await myCaller.dispose();
  }
});

test("only one session is ever the one you are using", async () => {
  const first = await freshToken("analyst");
  const second = await freshToken("analyst");
  const firstCaller = await callerFor(first.token);
  const secondCaller = await callerFor(second.token);

  try {
    await firstCaller.get(url("/sessions"));
    const listing = await (await secondCaller.get(url("/sessions"))).json();
    const current = (listing.items as Array<Record<string, unknown>>).filter(
      (row) => row["current"] === true,
    );
    // The seed marked the first five sessions of every user as current, so
    // somebody with three had three of them claiming to be the one they were
    // reading the page from.
    expect(current.length).toBe(1);
  } finally {
    await firstCaller.dispose();
    await secondCaller.dispose();
    // Left signed in: these two sessions belong to nothing else, and the
    // suite's own tokens are separate.
  }
});

test("no seeded session claims to be current for two people at once", async () => {
  // Asked of the installation rather than of a fixture: `--check` reports the
  // same invariant, and this is the browser-visible half of it.
  const api = await apiAs("admin");
  const listing = await (await api.get(url("/sessions"))).json();
  const current = (listing.items as Array<Record<string, unknown>>).filter(
    (row) => row["current"] === true,
  );
  expect(current.length).toBeLessThanOrEqual(1);
  // A revoked session cannot be the one anybody is using.
  const contradictions = (listing.items as Array<Record<string, unknown>>).filter(
    (row) => row["current"] === true && row["state"] !== "ACTIVE",
  );
  expect(contradictions).toEqual([]);
});

test("the sign-in history keeps failures apart from successes", async () => {
  const api = await apiAs("admin");
  const whole = await (await api.get(url("/sign-ins?page_size=200"))).json();
  const failures = await (await api.get(url("/sign-ins?result=FAILURE&page_size=200"))).json();

  expect(whole.total).toBeGreaterThan(0);
  // Narrowed in PostgreSQL: the total moves with the filter rather than only
  // the rows on screen (§71).
  expect(failures.total).toBeLessThanOrEqual(whole.total);
  const results = new Set(
    (failures.items as Array<{ result: string }>).map((row) => row.result),
  );
  expect([...results].every((value) => value === "FAILURE")).toBe(true);
});

test.describe("what the least-privileged persona is offered", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("the whole page, because it is their own account", async ({ page }) => {
    // A security page that had to be granted is one most people never see.
    await signIn(page, "viewer", "/settings/security");
    await expect(page.getByTestId("sessions-table")).toBeVisible();
    await expect(page.getByTestId("sign-ins-card")).toBeVisible();
    await expect(page.getByTestId("events-card")).toBeVisible();

    const api = await apiAs("viewer");
    expect((await api.get(url("/overview"))).status()).toBe(200);
  });
});

test.describe("the page in a browser", () => {
  test.use({ storageState: storageStateFor("manager") });

  test("marks the device it was opened from and offers to sign the others out", async ({
    page,
  }) => {
    await signIn(page, "manager", "/settings/security");
    await expect(page.getByTestId("sessions-table")).toBeVisible();
    await expect(
      page.getByTestId("sessions-table").locator("tbody tr[data-row-key]").first(),
    ).toBeVisible();

    // The row somebody looks for first, and it is only there because the
    // request recorded its own session.
    await expect(page.getByText("This device, right now")).toBeVisible();
    await expect(page.getByTestId("security-headline")).toBeVisible();
    // The sweep says its own scope, rather than being an action of unknown
    // reach.
    await expect(page.getByTestId("revoke-others")).toBeVisible();
  });

  test("asks a different question before signing you out of this device", async ({ page }) => {
    await signIn(page, "manager", "/settings/security");
    await expect(page.getByTestId("sessions-table")).toBeVisible();

    const row = page
      .getByTestId("sessions-table")
      .locator("tbody tr[data-row-key]")
      .filter({ hasText: "This device, right now" });
    await row.getByRole("button", { name: "Sign me out" }).click();

    // Pressing "revoke" down a list and landing on your own row is how
    // somebody loses their work, so the copy says what will happen — and this
    // test declines it.
    await expect(page.getByText(/sent back to the sign-in page/)).toBeVisible();
    await page.getByRole("button", { name: "Leave it" }).click();
    await expect(page.getByText("This device, right now")).toBeVisible();
  });

  test("narrows the history to the failures", async ({ page }) => {
    await signIn(page, "manager", "/settings/security");
    await expect(page.getByTestId("sign-ins-table")).toBeVisible();

    // The label, not the radio: AntD's Segmented puts `pointer-events: none`
    // on the input.
    await page.locator(".ant-segmented-item-label", { hasText: "Failures only" }).click();

    const table = page.getByTestId("sign-ins-table");
    await expect(table).toBeVisible();
    const rows = await table.locator("tbody tr[data-row-key]").count();
    if (rows === 0) {
      // A persona with no failures gets the good news rather than an empty
      // table — which is itself the assertion.
      await expect(page.getByText(/That is the answer you want/)).toBeVisible();
    } else {
      await expect(table.locator("tbody tr[data-row-key]").first()).toContainText("Failed");
    }
  });

  test("the page is legible and keyboard-reachable", async ({ page }) => {
    await signIn(page, "manager", "/settings/security");
    await expect(page.getByTestId("sessions-table")).toBeVisible();
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
        nodes: violation.nodes.map(
          (node) => `${node.target.join(" ")} :: ${node.failureSummary}`,
        ),
      })),
    ).toEqual([]);
  });
});
