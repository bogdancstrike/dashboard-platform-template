import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { apiAs, namespaced } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * API clients and their credentials against the real stack (§25).
 *
 * The claim only a real stack can make, and the reason this page exists:
 * **the secret really is unrecoverable.** A fixture can be written to withhold
 * it; only PostgreSQL can show that the plaintext is in no row and no later
 * response — which is what turns "shown once" from a policy into a property.
 *
 * Plus: that rotation leaves *two* live keys and a deadline rather than one,
 * because a rotation that killed the old secret immediately is an outage with
 * extra steps; and that a second revoke is refused, since "revoke" succeeding
 * twice suggests the first did not take.
 *
 * Everything this spec registers, it retires.
 */

test.describe.configure({ mode: "serial" });

/** Retire a client by id, whatever happened to the test that made it. */
async function sweep(ids: string[]) {
  const api = await apiAs("admin");
  for (const id of ids) {
    await api.delete(namespaced(`/admin/api-clients/${id}`));
  }
}

async function confirm(page: import("@playwright/test").Page, label: string) {
  const button = page.getByRole("button", { name: label, exact: true });
  await expect(button).toBeVisible();
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
  await button.click();
}

test("the list says what each machine may do", async ({ page }) => {
  await signIn(page, "admin", "/admin/api");
  await expect(page.getByTestId("clients-table")).toBeVisible();
  await expect(
    page.getByTestId("clients-table").locator("tbody tr[data-row-key]").first(),
  ).toBeVisible();
});

test("a minted secret is in no row and no later response", async ({ page }) => {
  // The property the whole design rests on. Not "the API refuses to send it"
  // — there is nothing to send.
  const api = await apiAs("admin");
  const made: string[] = [];

  try {
    const answer = await api.post(namespaced("/admin/api-clients"), {
      data: { name: `E2E secret ${Date.now()}`, scopes: ["records.view"] },
    });
    expect(answer.status()).toBe(201);
    const body = await answer.json();
    made.push(body.id as string);

    const secret = body.secret as string;
    expect(secret).toMatch(/^nuc_/);
    expect(body.secret_shown_once).toBe(true);

    // Every endpoint that returns this credential, asked in turn.
    for (const path of [
      "/admin/api-clients",
      `/admin/api-clients/${body.id}`,
      "/admin/api-clients/catalogue",
    ]) {
      const later = await (await api.get(namespaced(path))).text();
      expect(later, `${path} carried the secret`).not.toContain(secret);
    }

    // And the page itself never renders it after the modal is gone.
    await signIn(page, "admin", `/admin/api?client=${body.id}`);
    await expect(page.getByTestId("client-keys")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(secret);
  } finally {
    await sweep(made);
  }
});

test("registering shows the key once, in a box that will not close by accident", async ({
  page,
}) => {
  const made: string[] = [];
  try {
    await signIn(page, "admin", "/admin/api");
    await expect(page.getByTestId("clients-table")).toBeVisible();

    await page.getByTestId("new-client").click();
    // Warned before it exists.
    await expect(page.getByText("Its key is shown once")).toBeVisible();
    await page.getByLabel("Client name").fill(`E2E registered ${Date.now()}`);
    await page.getByTestId("create-client").click();

    const modal = page.getByTestId("secret-modal");
    await expect(modal).toBeVisible();
    const shown = await modal.getByTestId("secret-value").innerText();
    expect(shown).toMatch(/^nuc_/);

    // Clicking the mask does not dismiss it: the value exists nowhere else.
    await page.mouse.click(5, 5);
    await expect(modal).toBeVisible();

    // And confirming asks again, with a way back.
    await confirm(page, "I have copied it");
    await expect(page.getByRole("button", { name: "Wait, let me copy it" })).toBeVisible();
    await confirm(page, "I have it");
    await expect(modal).toBeHidden();

    // The id comes from the address, not from a name search: the page opens the
    // client it just made, and `find()` on a name prefix picks whichever row
    // came back first — which swept an *earlier* run's client and left this
    // one behind, three times over.
    const opened = new URL(page.url()).searchParams.get("client");
    expect(opened, "the page did not open the client it registered").toBeTruthy();
    made.push(opened!);
  } finally {
    await sweep(made);
  }
});

test("rotation leaves two live keys and a deadline", async ({ page }) => {
  // A rotation that killed the previous secret the instant a new one was
  // minted is an outage with extra steps: every caller holding the old key
  // fails until somebody redeploys them.
  const api = await apiAs("admin");
  const made: string[] = [];

  try {
    const created = await (
      await api.post(namespaced("/admin/api-clients"), {
        data: { name: `E2E rotation ${Date.now()}` },
      })
    ).json();
    made.push(created.id as string);
    const first = created.credential.id as string;

    const rotated = await (
      await api.post(namespaced(`/admin/api-clients/${created.id}/rotate`), {
        data: { credential_id: first },
      })
    ).json();

    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.credential.rotated_from_id).toBe(first);
    // The old key still works, with an expiry — that is the whole point.
    expect(rotated.replaced.state).toBe("ACTIVE");
    expect(rotated.replaced.expires_at).toBeTruthy();
    expect(rotated.grace_days).toBeGreaterThan(0);

    // Two live keys, as the page shows them.
    await signIn(page, "admin", `/admin/api?client=${created.id}`);
    const keys = page.getByTestId("client-keys");
    await expect(keys).toBeVisible();
    await expect(keys.getByText("active")).toHaveCount(2);
    await expect(keys.getByText(/Expires in \d+ days/)).toBeVisible();
  } finally {
    await sweep(made);
  }
});

test("revoking is immediate, keeps the row, and cannot be done twice", async ({ page }) => {
  const api = await apiAs("admin");
  const made: string[] = [];

  try {
    const created = await (
      await api.post(namespaced("/admin/api-clients"), {
        data: { name: `E2E revocation ${Date.now()}` },
      })
    ).json();
    made.push(created.id as string);
    const credentialId = created.credential.id as string;

    await signIn(page, "admin", `/admin/api?client=${created.id}`);
    const prefix = created.credential.prefix as string;
    await expect(page.getByTestId(`key-${prefix}`)).toBeVisible();

    await page.getByTestId(`revoke-${prefix}`).click();
    // Said before it happens: there is no grace period here.
    await expect(page.getByText(/no grace period/)).toBeVisible();
    await confirm(page, "Revoke it");
    await expect(page.getByText(/will fail now/)).toBeVisible();

    // The row is still listed — the question after a leak is when and by whom.
    await expect(page.getByTestId(`key-${prefix}`)).toBeVisible();
    await expect(page.getByTestId(`key-${prefix}`)).toContainText("revoked");
    // And nothing left to press on it.
    await expect(page.getByTestId(`revoke-${prefix}`)).toHaveCount(0);

    // A second revoke is refused rather than quietly accepted.
    const again = await api.delete(namespaced(`/admin/api-credentials/${credentialId}`));
    expect(again.status()).toBe(409);
    expect((await again.json()).message).toContain("already revoked");
  } finally {
    await sweep(made);
  }
});

test("retiring a client revokes every key it holds", async ({ page }) => {
  // A soft-deleted client whose credentials stayed live would be a consumer
  // nothing lists any more, still able to call.
  const api = await apiAs("admin");
  const created = await (
    await api.post(namespaced("/admin/api-clients"), {
      data: { name: `E2E retirement ${Date.now()}` },
    })
  ).json();
  await api.post(namespaced(`/admin/api-clients/${created.id}/rotate`), { data: {} });

  await signIn(page, "admin", `/admin/api?client=${created.id}`);
  await expect(page.getByTestId("client-keys")).toBeVisible();

  await page.getByTestId("retire-client").click();
  await expect(page.getByText(/live keys are revoked with it/)).toBeVisible();
  await confirm(page, "Retire it");
  await expect(page.getByText(/2 live keys revoked/)).toBeVisible();

  // Gone from the listing, and its keys are dead.
  const gone = await api.get(namespaced(`/admin/api-clients/${created.id}`));
  expect(gone.status()).toBe(404);
});

test.describe("what a manager is offered", () => {
  test.use({ storageState: storageStateFor("manager") });

  test("nothing — a client's scopes are what an attacker would want first", async ({
    page,
  }) => {
    // Reading is not a lesser privilege here: a client's scopes and its
    // allowed addresses are exactly the reconnaissance somebody would do.
    await signIn(page, "manager", "/admin/api");
    await expect(page.getByTestId("clients-table")).toHaveCount(0);

    const api = await apiAs("manager");
    expect((await api.get(namespaced("/admin/api-clients"))).status()).toBe(403);
  });
});

test("the page is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/admin/api");
  await expect(page.getByTestId("clients-table")).toBeVisible();
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
