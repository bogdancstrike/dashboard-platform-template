import type { Page } from "@playwright/test";

/**
 * The pages audit A owns: the shell's own surfaces are exercised on every one
 * of them, and the pages themselves are listed here.
 *
 * A route with an id is written as `{ from, link }`: the audit opens the list
 * and follows the first link that matches, so it audits a record that exists
 * in whatever database it runs against rather than an id baked into a file.
 */
export type AuditRoute =
  | { name: string; path: string }
  /** `click`: when the list opens its records by click rather than by link. */
  | { name: string; from: string; link: RegExp; click?: string };

export const ROUTES: AuditRoute[] = [
  { name: "home", path: "/home" },
  { name: "dashboard", path: "/dashboard" },
  { name: "dashboards", path: "/dashboards" },
  { name: "dashboard-view", from: "/dashboards", link: /^\/dashboards\/[0-9a-f-]{36}$/, click: "[data-testid^='board-card-'] h3, [data-testid^='board-card-']" },
  { name: "activity", path: "/activity" },
  { name: "notifications", path: "/notifications" },
  { name: "announcements", path: "/announcements" },
  { name: "analytics", path: "/analytics" },
  { name: "reports", path: "/reports" },
  { name: "report-builder", path: "/reports/builder" },
  { name: "chart-builder", path: "/charts/builder" },
  { name: "maps", path: "/maps" },
  { name: "insights", path: "/ai/insights" },
  { name: "assistant", path: "/assistant" },
  { name: "documents", path: "/ai/documents" },
  { name: "tasks", path: "/tasks" },
  { name: "task-detail", from: "/tasks", link: /^\/tasks\/[0-9a-f-]{36}$/, click: "[data-testid^='task-card-']" },
  { name: "timeline", path: "/timeline" },
  { name: "sprints", path: "/sprints" },
  { name: "kanban", path: "/kanban" },
  { name: "workflows", path: "/workflows" },
  { name: "calendar", path: "/calendar" },
  { name: "mail", path: "/mail" },
  { name: "files", path: "/files" },
  { name: "chat", path: "/chat" },
  { name: "docs", path: "/docs" },
  { name: "doc-page", from: "/docs", link: /^\/docs\/[0-9a-f-]{36}$/ },
  { name: "time", path: "/time" },
  { name: "approvals", path: "/approvals" },
  { name: "alerts", path: "/alerts" },
  { name: "alert-detail", from: "/alerts", link: /^\/alerts\/[0-9a-f-]{36}$/, click: ".nx-ra-watch" },
  { name: "contracts", path: "/contracts" },
  { name: "contract-detail", from: "/contracts", link: /^\/contracts\/[0-9a-f-]{36}$/, click: "[data-testid^='contract-card-']" },
  { name: "customer-health", path: "/customers/health" },
];

/** Where a route is right now: its own path, or the first matching link on its list page. */
export async function resolve(page: Page, route: AuditRoute): Promise<string | null> {
  if ("path" in route) return route.path;
  await page.goto(route.from);
  await page.waitForSelector(".nx-app", { timeout: 60_000 });
  const pattern = route.link.source;
  await page.waitForTimeout(1500);
  const found = await page
    .waitForFunction(
      (source) => {
        const re = new RegExp(source);
        return (
          [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
            .map((a) => new URL(a.href).pathname)
            .find((path) => re.test(path)) ?? null
        );
      },
      pattern,
      { timeout: route.click ? 3_000 : 20_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  if (found || !route.click) return found;
  // Opened by a click on a card: press the first one and read where it went.
  const card = page.locator(route.click).first();
  if (!(await card.count().catch(() => 0))) return null;
  await card.click({ timeout: 10_000 }).catch(() => undefined);
  await page.waitForURL((url) => route.link.test(url.pathname), { timeout: 15_000 }).catch(() => undefined);
  const path = new URL(page.url()).pathname;
  return route.link.test(path) ? path : null;
}
