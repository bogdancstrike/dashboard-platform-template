// Shared plumbing for the audit-B harness: sign-in per persona, a theme-pinned
// context, and the in-page glitch probes. Plain Node + Playwright (not the test
// runner) so a crawl of hundreds of states can be driven, resumed and filtered
// freely; the runnable regression guard lives in the *.spec.ts next to it.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

export const BASE = process.env.BASE_URL || "http://localhost:8090";
export const OUT = process.env.AUDIT_OUT || path.resolve("e2e/audit-b/.out");
export const SHOTS = process.env.AUDIT_SHOTS || OUT;
export const SIZES = { pc: [1440, 900], tablet: [1194, 834], phone: [390, 844] };
export const PERSONAS = { admin: "admin", operator: "operator", user: "user" };

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

export async function launch() {
  return chromium.launch();
}

function statePath(persona) {
  return path.join(OUT, `auth-${persona}.json`);
}

/** One real Keycloak sign-in per persona, cached for 20 minutes. */
export async function ensureLogin(browser, persona = "admin") {
  const file = statePath(persona);
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 20 * 60_000) return file;
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  await pg.goto(BASE + "/home");
  for (let i = 0; i < 160; i++) {
    try {
      if (await pg.locator(".nx-app").count()) break;
      if (await pg.locator("#username").count()) {
        await pg.fill("#username", PERSONAS[persona]);
        await pg.fill("#password", PERSONAS[persona]);
        await pg.click("#kc-login, [type=submit]");
        await pg.waitForTimeout(1500);
      }
    } catch {
      /* navigation in flight */
    }
    await pg.waitForTimeout(500);
  }
  await ctx.storageState({ path: file });
  await ctx.close();
  return file;
}

/**
 * A context at one device size with the theme pinned: the account's stored
 * appearance wins over localStorage once /me resolves, so /me is rewritten.
 */
export async function context(browser, { persona = "admin", device = "pc", theme = "light" } = {}) {
  const [w, h] = SIZES[device];
  const ctx = await browser.newContext({
    storageState: await ensureLogin(browser, persona),
    viewport: { width: w, height: h },
    colorScheme: theme,
    hasTouch: device === "phone",
    isMobile: false,
  });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("nucleus.appearance", t);
      localStorage.setItem("nucleus.tour.dismissed", "1");
    } catch {
      /* private mode */
    }
    // Cumulative layout shift, read back by `probe()`.
    window.__cls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      /* unsupported */
    }
  }, theme);
  // A private dev server on a port the realm does not list as a web origin
  // (to verify fixes before they are pushed): answer Keycloak's CORS for it.
  if (!/:(5174|3000|8090)\b/.test(BASE)) {
    const origin = new URL(BASE).origin;
    await ctx.route("**/realms/**/protocol/openid-connect/**", async (route) => {
      const cors = {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
      };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (route.request().resourceType() === "document") return route.continue();
      const res = await route.fetch().catch(() => null);
      if (!res) return route.abort().catch(() => undefined);
      await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
    });
  }
  // The app syncs the local theme/density back to the account with PUT /me.
  // An audit must never change the shared persona, so writes to /me are
  // answered here (echoing the body) and never reach the API; the theme is
  // pinned only by rewriting what GET /me returns.
  let pinned = null;
  await ctx.route("**/platform/api/me", async (route) => {
    const method = route.request().method();
    if (method === "PUT" || method === "PATCH") {
      let sent = {};
      try {
        sent = route.request().postDataJSON() ?? {};
      } catch {
        /* not JSON */
      }
      // The server merges a partial write into the whole; so must the echo,
      // or the page reads `undefined.landing_page` from its own reply.
      const base = pinned ?? {};
      const merged = { ...base, ...sent, user: { ...(base.user ?? {}), ...(sent.user ?? {}) } };
      merged.preferences = { ...(base.preferences ?? {}) };
      for (const [k, v] of Object.entries(sent.preferences ?? {}))
        merged.preferences[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(merged.preferences[k] ?? {}), ...v } : v;
      if (!sent.user) delete merged.user;
      if (!base.user && !sent.user) delete merged.user;
      pinned = { ...base, preferences: merged.preferences };
      return route.fulfill({ status: 200, json: sent.user ? { ...base, ...sent.user } : merged });
    }
    if (method !== "GET") return route.continue();
    // The stack redeploys under us now and then; a dropped fetch must not
    // take the whole crawl down with an unhandled rejection.
    const res = await route.fetch().catch(() => null);
    if (!res) return route.abort().catch(() => undefined);
    const body = await res.json().catch(() => null);
    if (body?.preferences?.appearance) body.preferences.appearance.theme = theme;
    pinned = body;
    await route.fulfill({ response: res, json: body });
  });
  await ctx.route("**/platform/api/me/preferences**", (route) =>
    route.request().method() === "GET" ? route.continue() : route.fulfill({ status: 200, json: {} }),
  );
  return ctx;
}

/** Console errors/warnings, page errors, failed and >=400 requests, per page. */
export function watch(page) {
  const log = { console: [], pageErrors: [], failed: [], http: [] };
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      const text = m.text();
      // Vite/React dev chatter is not a product glitch.
      if (/Download the React DevTools|\[vite\]|React Router Future Flag/.test(text)) return;
      log.console.push(`${m.type()}: ${text.slice(0, 300)}`);
    }
  });
  page.on("pageerror", (e) => log.pageErrors.push(String(e.message).slice(0, 300)));
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText || "";
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(f)) return; // navigations cancel in-flight fetches
    log.failed.push(`${r.method()} ${r.url()} ${f}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().includes("/realms/")) log.http.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return log;
}

export async function settle(page, extra = 600) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => !document.querySelector(".ant-spin-spinning, .ant-skeleton-active"), undefined, {
      timeout: 8_000,
    })
    .catch(() => undefined);
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 5_000 })
    .catch(() => undefined);
  await page.waitForTimeout(extra);
}

/** Geometry probes run inside the page. Returns plain findings. */
export async function probe(page) {
  return page.evaluate(() => {
    const out = { overflowX: 0, offscreen: [], clipped: [], overlaps: [], small: [], squareCorners: [], cls: window.__cls || 0 };
    const vw = window.innerWidth;
    const de = document.documentElement;
    out.overflowX = Math.max(0, de.scrollWidth - de.clientWidth, document.body.scrollWidth - de.clientWidth);
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
      return true;
    };
    const describe = (el) => {
      const id = el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.id || "";
      const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
      const txt = (el.innerText || el.value || "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${id ? `[${id}]` : ""}${txt ? ` "${txt}"` : ""}`;
    };
    // Is the element inside something that scrolls/clips horizontally (a table, carousel)?
    const inScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true;
      }
      return false;
    };
    const all = [...document.querySelectorAll(".nx-app *, .ant-modal *, .ant-drawer *, .ant-popover *, .ant-dropdown *, body > div *")];
    for (const el of all) {
      if (out.offscreen.length > 15) break;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0 && r.width < vw * 3 && visible(el) && !inScroller(el)) out.offscreen.push(`${describe(el)} right=${Math.round(r.right)}`);
    }
    // Text clipped without an ellipsis: overflow hidden + content wider than box.
    for (const el of all) {
      if (out.clipped.length > 15) break;
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const s = getComputedStyle(el);
      if (!/(hidden|clip)/.test(s.overflowX) && !/(hidden|clip)/.test(s.overflow)) continue;
      if (s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none") continue;
      if (el.clientWidth <= 1 || el.clientHeight <= 1) continue; // visually-hidden label, on purpose
      if (el.scrollWidth > el.clientWidth + 2 && visible(el)) out.clipped.push(`${describe(el)} ${el.scrollWidth}>${el.clientWidth}`);
      else if (el.scrollHeight > el.clientHeight + 3 && s.whiteSpace !== "nowrap" && visible(el) && el.clientHeight > 0 && el.clientHeight < 80)
        out.clipped.push(`${describe(el)} h ${el.scrollHeight}>${el.clientHeight}`);
    }
    const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=radio], .ant-select-selector')].filter(
      (el) => visible(el) && !el.closest('[aria-hidden="true"], .ant-tooltip, .ant-picker-dropdown, .ant-select-dropdown'),
    );
    // Target size (WCAG 2.5.8): 24x24 unless it is a link inside running text.
    for (const el of controls) {
      if (out.small.length > 20) break;
      const r = el.getBoundingClientRect();
      if (r.width >= 24 && r.height >= 24) continue;
      if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue;
      if (el.matches("input[type=checkbox], input[type=radio]") && el.closest("label, .ant-checkbox-wrapper, .ant-radio-wrapper")) continue;
      if (el.closest(".ant-checkbox-wrapper, .ant-radio-wrapper, .ant-switch, .ant-slider, .ant-rate")) continue;
      out.small.push(`${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    // Overlapping controls: two unrelated controls sharing a meaningful area.
    const rects = controls.slice(0, 400).map((el) => [el, el.getBoundingClientRect()]);
    for (let i = 0; i < rects.length && out.overlaps.length < 15; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [a, ra] = rects[i];
        const [b, rb] = rects[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ix > 4 && iy > 4 && ix * iy > 0.25 * Math.min(ra.width * ra.height, rb.width * rb.height)) {
          // Only report if both are actually on top somewhere (not hidden behind an overlay).
          const top = (el, r) => {
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return hit && (el === hit || el.contains(hit));
          };
          if (top(a, ra) || top(b, rb)) out.overlaps.push(`${describe(a)} x ${describe(b)}`);
        }
      }
    }
    // Square corners behind rounded glass: a child that covers its rounded
    // parent edge-to-edge with an opaque background, square corners, and the
    // parent does not clip.
    for (const el of all) {
      if (out.squareCorners.length > 10) break;
      const s = getComputedStyle(el);
      const rad = parseFloat(s.borderTopLeftRadius);
      if (!(rad >= 10) || s.overflow !== "visible") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40) continue;
      for (const c of el.children) {
        const cs = getComputedStyle(c);
        const bg = cs.backgroundColor;
        if (!bg || bg === "transparent" || /rgba\(.*,\s*0\)$/.test(bg)) continue;
        if (parseFloat(cs.borderTopLeftRadius) >= rad / 2) continue;
        const cr = c.getBoundingClientRect();
        if (Math.abs(cr.left - r.left) < 2 && Math.abs(cr.top - r.top) < 2 && cr.width >= r.width - 2) {
          out.squareCorners.push(`${describe(c)} in ${describe(el)} r=${rad}`);
          break;
        }
      }
    }
    return out;
  });
}

export async function axe(page) {
  try {
    const res = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .exclude(".ant-tooltip")
      .analyze();
    return res.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      n: v.nodes.length,
      targets: v.nodes.slice(0, 4).map((n) => `${n.target.join(" ")}${n.any?.[0]?.message ? " — " + n.any[0].message.slice(0, 120) : ""}`),
    }));
  } catch (e) {
    return [{ id: "axe-crashed", impact: "n/a", n: 0, targets: [String(e).slice(0, 200)] }];
  }
}

export function slug(s) {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
}
