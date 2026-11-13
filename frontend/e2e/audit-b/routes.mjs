// The audit-B surface, with the ids a detail route needs resolved from the
// live lists (first row of each) so the crawl never depends on seed uuids.
import { BASE, context } from "./lib.mjs";

export const ENTITIES = ["projects", "customers", "orders", "tickets", "devices"];

export const ROUTES = (ids) => [
  ...ENTITIES.flatMap((e) => [`/${e}`, `/${e}/grid`, ids[e] ? `/${e}/${ids[e]}` : null]),
  "/explore",
  "/find/global",
  "/find/global?q=acme",
  "/find/relationships",
  "/find/catalog",
  "/favorites",
  "/admin",
  "/admin/users",
  ids.user ? `/admin/users/${ids.user}` : null,
  "/admin/groups",
  "/admin/roles",
  "/admin/organizations",
  "/admin/audit",
  "/admin/logs",
  "/admin/jobs",
  "/admin/health",
  "/admin/api",
  "/admin/integrations",
  "/admin/flags",
  "/admin/settings",
  "/admin/sla",
  "/admin/forms",
  ids.form ? `/admin/forms/${ids.form}` : null,
  ids.formSlug ? `/f/${ids.formSlug}` : null,
  "/admin/quality",
  "/admin/tags",
  "/import",
  "/exports",
  "/showcase/components",
  "/showcase/templates",
  "/profile",
  ids.colleague ? `/profile/${ids.colleague}` : null,
  "/settings/preferences",
  "/settings/security",
  "/compare",
  "/errors/401",
  "/errors/403",
  "/errors/404",
  "/errors/500",
  "/errors/maintenance",
  "/errors/session-expired",
  "/errors/switched-off",
  "/no-such-page",
].filter(Boolean);

/** First id on each list, read through the app's own API with its token. */
export async function resolveIds(browser, persona = "admin") {
  const ctx = await context(browser, { persona });
  const page = await ctx.newPage();
  let token = "";
  page.on("request", (r) => {
    const h = r.headers()["authorization"];
    if (h?.startsWith("Bearer ")) token = h.slice(7);
  });
  await page.goto(BASE + "/home");
  await page.waitForSelector(".nx-app", { timeout: 60_000 }).catch(() => undefined);
  for (let i = 0; i < 40 && !token; i++) await page.waitForTimeout(250);
  const get = async (p) => {
    const r = await page.request.get(BASE + "/platform" + p, { headers: { Authorization: `Bearer ${token}` } });
    return r.ok() ? r.json() : null;
  };
  const ids = { token };
  const first = (body) => {
    const list = Array.isArray(body) ? body : body?.items ?? body?.data ?? body?.results ?? body?.records ?? [];
    return list[0];
  };
  for (const e of ENTITIES) {
    await page.goto(`${BASE}/${e}`);
    const re = new RegExp(`/${e}/([0-9a-f-]{36})`);
    for (let i = 0; i < 60 && !ids[e]; i++) {
      const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href"))).catch(() => []);
      ids[e] = hrefs.map((h) => h && h.match(re)?.[1]).find(Boolean);
      if (!ids[e]) await page.waitForTimeout(250);
    }
    if (!ids[e]) {
      // Lists whose rows navigate on click rather than via a link.
      const row = page.locator(".nu-account .nu-account-name, .nu-device .nu-device-head strong, .ant-table-row").first();
      if (await row.count()) {
        await row.click().catch(() => undefined);
        await page.waitForTimeout(800);
        ids[e] = page.url().match(re)?.[1];
      }
    }
  }
  const users = await get("/admin/users?page_size=5").catch(() => null);
  const ul = users?.items ?? users?.data ?? [];
  ids.user = ul.find((u) => u.username === "operator")?.id ?? ul[0]?.id;
  ids.colleague = ul.find((u) => u.username !== "admin")?.id;
  const forms = await get("/api/forms").catch(() => null);
  const f = first(forms);
  ids.form = f?.id;
  ids.formSlug = (forms?.items ?? forms ?? []).find?.((x) => x.is_public || x.public)?.slug ?? f?.slug;
  await ctx.close();
  return ids;
}
