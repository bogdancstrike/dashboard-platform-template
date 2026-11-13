import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { apiAs, endpoint, namespaced } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * Feature flags against the real stack (§27).
 *
 * Four features are switched off — the AI assistant, time tracking, team chat
 * and kanban — and the claims are the ones only the whole stack can make: the
 * menu, the header and the routes lose them, the API refuses a direct call with
 * `feature_disabled`, the change reaches an open tab without a reload, and
 * turning them back on restores everything.
 *
 * **Off for one role, not for everybody.** The stack is shared — other suites
 * and people use it while this runs — so each flag is switched off by
 * *targeting*: on at 0 % for every role except the analyst's. That is also the
 * rollout/targeting path itself, end to end. Every flag is put back at its
 * seeded state (on, 100 %, nobody named) however the tests end.
 */

test.describe.configure({ mode: "serial" });

const FLAGS = ["ai-assistant", "time-tracking", "chat", "kanban-board"] as const;
const EVERYONE_BUT_ANALYSTS = ["ADMINISTRATOR", "MANAGER", "OPERATOR", "VIEWER"];
const SEEDED = { enabled: true, rollout_percentage: 100, target_roles: [], target_user_ids: [], target_group_ids: [], target_organization_ids: [] };

async function setFlag(admin: APIRequestContext, key: string, body: Record<string, unknown>) {
  const response = await admin.put(namespaced(`/admin/flags/${key}`), { data: body });
  expect(response.ok(), `PUT /admin/flags/${key} → ${response.status()}`).toBe(true);
}

async function restoreAll() {
  const admin = await apiAs("admin");
  try {
    for (const key of FLAGS) await setFlag(admin, key, SEEDED);
  } finally {
    await admin.dispose();
  }
}

test.beforeAll(async () => {
  const admin = await apiAs("admin");
  try {
    for (const key of FLAGS) {
      await setFlag(admin, key, { enabled: true, rollout_percentage: 0, target_roles: EVERYONE_BUT_ANALYSTS });
    }
  } finally {
    await admin.dispose();
  }
});

test.afterAll(restoreAll);

const menu = (page: Page, name: RegExp) => page.getByRole("menuitem", { name });

test.describe("for the reader they are off for", () => {
  test.use({ storageState: storageStateFor("analyst") });

  test("the menu, the header and the routes lose them", async ({ page }) => {
    await signIn(page, "analyst", "/dashboard");
    await expect(menu(page, /Tasks/).first()).toBeVisible();
    await expect(menu(page, /Kanban boards/)).toHaveCount(0);
    await expect(menu(page, /Time & timesheets/)).toHaveCount(0);
    await expect(menu(page, /^Chat/)).toHaveCount(0);
    await expect(menu(page, /^Assistant/)).toHaveCount(0);
    await expect(page.getByTestId("timer-pill")).toHaveCount(0);
    await expect(page.getByTestId("assistant-launcher")).toHaveCount(0);

    for (const path of ["/kanban", "/time", "/chat", "/assistant"]) {
      await page.goto(path);
      await expect(page.getByTestId("problem-switched_off"), path).toBeVisible();
    }
  });

  test("and the API refuses them when called directly", async ({ page }) => {
    await signIn(page, "analyst", "/dashboard");
    const analyst = await apiAs("analyst");
    try {
      for (const [path, key] of [
        ["/kanban/boards", "kanban-board"],
        ["/time/week", "time-tracking"],
        ["/chat/channels", "chat"],
        ["/assistant/conversations", "ai-assistant"],
      ] as const) {
        const response = await analyst.get(endpoint(path));
        expect(response.status(), path).toBe(404);
        expect(await response.json()).toMatchObject({ error: "feature_disabled", feature: key });
      }
      // A feature nobody switched off still answers.
      expect((await analyst.get(endpoint("/maps/catalog"))).status()).toBe(200);
    } finally {
      await analyst.dispose();
    }
  });

  test("turning one back on reaches an open tab without a reload", async ({ page }) => {
    await signIn(page, "analyst", "/dashboard");
    await expect(menu(page, /Tasks/).first()).toBeVisible();
    await expect(menu(page, /Time & timesheets/)).toHaveCount(0);
    const marker = await page.evaluate(() => {
      (window as unknown as { __noReload: number }).__noReload = 1;
      return 1;
    });
    expect(marker).toBe(1);

    const admin = await apiAs("admin");
    try {
      await setFlag(admin, "time-tracking", SEEDED);
    } finally {
      await admin.dispose();
    }
    // The live channel announces it; a polling tab picks it up within a minute.
    await expect(menu(page, /Time & timesheets/)).toBeVisible({ timeout: 70_000 });
    await expect(page.getByTestId("timer-pill").first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(1);
  });
});

test.describe("for everybody else", () => {
  test("they are all still there", async ({ page }) => {
    await signIn(page, "admin", "/dashboard");
    await expect(menu(page, /Kanban boards/)).toBeVisible();
    await expect(menu(page, /^Chat/)).toBeVisible();
    const admin = await apiAs("admin");
    try {
      expect((await admin.get(endpoint("/kanban/boards"))).status()).toBe(200);
      expect((await admin.get(endpoint("/chat/channels"))).status()).toBe(200);
    } finally {
      await admin.dispose();
    }
  });

  test("the flags screen says what switching one off would take away, before it does", async ({ page }) => {
    await signIn(page, "admin", "/admin/flags");
    await expect(page.getByTestId("flags-table")).toBeVisible();
    await page.getByRole("switch", { name: "Turn off Kanban boards" }).click();
    const dialog = page.getByRole("dialog", { name: "Turn off Kanban boards?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("/kanban", { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText(/\/api\/kanban\/boards/).first()).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe("after they are all back on", () => {
  test.use({ storageState: storageStateFor("analyst") });

  test("everything returns", async ({ page }) => {
    await restoreAll();
    await signIn(page, "analyst", "/kanban");
    await expect(page.getByTestId("problem-switched_off")).toHaveCount(0);
    await expect(menu(page, /Kanban boards/)).toBeVisible();
    await expect(page.getByTestId("assistant-launcher")).toBeVisible();
    const analyst = await apiAs("analyst");
    try {
      expect((await analyst.get(endpoint("/time/week"))).status()).toBe(200);
    } finally {
      await analyst.dispose();
    }
  });
});
