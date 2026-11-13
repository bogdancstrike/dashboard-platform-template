import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * The UI audit's eyes (audit A).
 *
 * Everything here measures the *rendered* page rather than the source: what a
 * reader at one width, in one appearance, would actually see. Each finding is a
 * short sentence naming the element, so a failure reads as a bug report rather
 * than a number.
 */

export type Device = "pc" | "tablet" | "phone";
export type Theme = "light" | "dark";

export const VIEWPORTS: Record<Device, { width: number; height: number }> = {
  pc: { width: 1440, height: 900 },
  tablet: { width: 1194, height: 834 },
  phone: { width: 390, height: 844 },
};

/**
 * Pin the appearance for this page.
 *
 * The account's saved theme wins over `localStorage` once `/me` resolves, and
 * switching it through the UI would write the shared persona's preference for
 * every other spec. Rewriting the one response is the change nobody else sees.
 */
export async function pinTheme(context: BrowserContext, theme: Theme): Promise<void> {
  await context.addInitScript((value) => {
    try {
      localStorage.setItem("nucleus.appearance", value);
    } catch {
      /* private mode */
    }
  }, theme);
  await context.route("**/platform/api/me", async (route) => {
    // The app writes the appearance it booted with back to the account. A
    // crawl must never change the shared persona, so the write is answered
    // here and goes no further.
    if (route.request().method() === "PUT" || route.request().method() === "PATCH") {
      const sent = route.request().postDataJSON() as unknown;
      return route.fulfill({ status: 200, json: sent ?? {} });
    }
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json().catch(() => null);
    if (body?.preferences?.appearance) body.preferences.appearance.theme = theme;
    await route.fulfill({ response, json: body });
  });
}

/** Cumulative layout shift, recorded from the first paint. */
export async function watchLayoutShift(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __cls: number; __shifts: string[] };
    w.__cls = 0;
    w.__shifts = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
          sources?: { node?: Node }[];
        }[]) {
          if (entry.hadRecentInput) continue;
          w.__cls += entry.value;
          const node = entry.sources?.[0]?.node as Element | undefined;
          if (entry.value > 0.01 && node?.className !== undefined)
            w.__shifts.push(`${node.tagName?.toLowerCase()}.${String(node.className).split(" ")[0]} ${entry.value.toFixed(3)}`);
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      /* unsupported */
    }
  });
}

/** Noise that is not the product: dev tooling and browser chatter. */
const IGNORED_CONSOLE = [
  /Download the React DevTools/,
  /\[vite\]/,
  /React Router Future Flag Warning/,
  // Keycloak's silent SSO iframe probes third-party cookies on every boot.
  /3p-cookies|silent-check-sso|step2\.html/,
  /Failed to load resource: the server responded with a status of 401/,
  // A websocket reconnecting after a deploy is the live provider doing its job.
  /WebSocket connection to .* failed/,
];

export type Collector = { console: string[]; requests: string[] };

export function collect(page: Page): Collector {
  const found: Collector = { console: [], requests: [] };
  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
    found.console.push(`${type}: ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (error) => found.console.push(`pageerror: ${error.message.slice(0, 300)}`));
  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    if (status < 400 || !url.includes("/platform/")) return;
    // 401 before the token refreshes is the auth handshake, not a failure.
    if (status === 401) return;
    found.requests.push(`${status} ${response.request().method()} ${url.replace(/^https?:\/\/[^/]+/, "")}`);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    // Navigating away aborts whatever the previous page had in flight.
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(failure)) return;
    found.requests.push(`failed ${request.method()} ${request.url().replace(/^https?:\/\/[^/]+/, "")} ${failure}`);
  });
  return found;
}

/** Wait for the page to stop moving: network quiet, animations finished. */
export async function settle(page: Page, extra = 400): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page
    .waitForFunction(
      () =>
        !document.querySelector(".ant-skeleton-active, .ant-spin-spinning") &&
        document.getAnimations().every((a) => a.playState !== "running" || (a.effect?.getTiming().iterations ?? 1) === Infinity),
      undefined,
      { timeout: 8_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(extra);
}

export type Layout = {
  horizontalOverflow: string | null;
  clipped: string[];
  small: string[];
  overlaps: string[];
  corners: string[];
  cls: number;
  shifts: string[];
};

/**
 * The geometric checks, run in the page.
 *
 * - horizontal overflow of the document;
 * - text clipped without an ellipsis (an ellipsis is a decision; a cut is a bug);
 * - interactive controls smaller than 24×24 (WCAG 2.5.8), inline links in prose excepted;
 * - two interactive controls painted on top of each other;
 * - a square child painting into a rounded card's cut-off corner.
 */
export async function measure(page: Page, scope = "body", includeFloating = false): Promise<Layout> {
  return page.evaluate(([scopeSelector, withFloating]) => {
    const root = document.querySelector(scopeSelector) ?? document.body;
    const describe = (el: Element) => {
      const id = el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? "";
      const cls = String((el as HTMLElement).className || "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${id ? `[${id}]` : ""}${text ? ` "${text}"` : ""}`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
      return !el.closest('[aria-hidden="true"], .ant-tooltip, .ant-select-selection-search, .ant-picker-input');
    };

    /** The part of an element its scrolling ancestors actually let through. */
    const shown = (el: Element): DOMRect => {
      let r = el.getBoundingClientRect();
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.overflowX === "visible" && ps.overflowY === "visible") continue;
        const pr = p.getBoundingClientRect();
        const left = Math.max(r.left, pr.left);
        const top = Math.max(r.top, pr.top);
        const right = Math.min(r.right, pr.right);
        const bottom = Math.min(r.bottom, pr.bottom);
        r = new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
      }
      return r;
    };

    const FLOATING = ".nx-ai-fab, .nx-tabs, .nx-tab, .nx-tabbar";
    const doc = document.scrollingElement!;
    const horizontalOverflow =
      doc.scrollWidth > window.innerWidth + 1 ? `document is ${doc.scrollWidth}px wide in a ${window.innerWidth}px viewport` : null;

    const clipped: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,button,a,span,label,th,td,p,.ant-tag,.ant-typography")) {
      if (!visible(el) || el.children.length > 2) continue;
      if (!el.textContent?.trim()) continue;
      // antd scales an avatar's initials to fit (a transform, not a cut), and
      // screen-reader-only text is clipped on purpose.
      if (el.closest(".ant-avatar")) continue;
      const s = getComputedStyle(el);
      if (s.clipPath !== "none" || s.clip !== "auto" || el.clientWidth <= 1) continue;
      if (s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none") continue;
      const overflowX = s.overflowX === "hidden" || s.overflowX === "clip";
      const overflowY = s.overflowY === "hidden" || s.overflowY === "clip";
      if (overflowX && el.scrollWidth > el.clientWidth + 2) clipped.push(`${describe(el)} cut horizontally (${el.scrollWidth}>${el.clientWidth})`);
      else if (overflowY && el.scrollHeight > el.clientHeight + 3 && s.whiteSpace !== "nowrap")
        clipped.push(`${describe(el)} cut vertically (${el.scrollHeight}>${el.clientHeight})`);
    }

    const interactive = [
      ...root.querySelectorAll<HTMLElement>(
        'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"], input:not([type="hidden"]), .ant-select-selector, .ant-segmented-item',
      ),
    ].filter(visible);

    const small: string[] = [];
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      if (r.width >= 24 && r.height >= 24) continue;
      // Text links (inline in a sentence, or a line of text in a list) are
      // exempt from the target-size rule; a control drawn as a box is not.
      if (el.tagName === "A") {
        const as = getComputedStyle(el);
        const boxed = as.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(as.paddingTop) > 2;
        if (as.display === "inline" || (!boxed && r.height >= 16)) continue;
      }
      // The real input inside a styled checkbox/radio/switch is invisible by design.
      if (el.matches(".ant-checkbox-input, .ant-radio-input, input[type=file]")) continue;
      const parentInteractive = el.parentElement?.closest("button, a, [role=button], label");
      if (parentInteractive) {
        const pr = parentInteractive.getBoundingClientRect();
        if (pr.width >= 24 && pr.height >= 24) continue;
      }
      small.push(`${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }

    const overlaps: string[] = [];
    const boxes = interactive
      .slice(0, 400)
      .map((el) => ({ el, r: shown(el) }))
      .filter(({ r }) => r.width > 0 && r.height > 0);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        // Content scrolling under the floating chrome (the phone tab bar, the
        // assistant button) is the design; whether the *end* of a page can
        // clear it is measured separately, with the page scrolled to its end.
        if (!withFloating && (a.el.closest(FLOATING) || b.el.closest(FLOATING))) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w <= 4 || h <= 4) continue;
        // Only a real collision: the one on top must actually cover the other's centre.
        const cx = Math.max(a.r.left, b.r.left) + w / 2;
        const cy = Math.max(a.r.top, b.r.top) + h / 2;
        const hit = document.elementFromPoint(cx, cy);
        if (!hit) continue;
        const onA = a.el.contains(hit);
        const onB = b.el.contains(hit);
        if (onA === onB) continue;
        if (w * h < Math.min(a.r.width * a.r.height, b.r.width * b.r.height) * 0.25) continue;
        overlaps.push(`${describe(a.el)} ⟂ ${describe(b.el)}`);
        if (overlaps.length > 12) break;
      }
    }

    const corners: string[] = [];
    for (const card of root.querySelectorAll<HTMLElement>(".ant-card, .nx-glass, .ant-modal-content, .ant-drawer-content, .ant-popover-inner, .ant-dropdown-menu")) {
      if (!visible(card)) continue;
      const s = getComputedStyle(card);
      const radius = parseFloat(s.borderTopLeftRadius);
      if (!(radius >= 10)) continue;
      const r = card.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) continue;
      const inset = 1.5;
      for (const [x, y, name] of [
        [r.left + inset, r.top + inset, "top-left"],
        [r.right - inset, r.top + inset, "top-right"],
        [r.left + inset, r.bottom - inset, "bottom-left"],
        [r.right - inset, r.bottom - inset, "bottom-right"],
      ] as const) {
        const hit = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!hit || hit === card || !card.contains(hit)) continue;
        const hs = getComputedStyle(hit);
        const bg = hs.backgroundColor;
        const painted = (bg && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(bg)) || hs.backgroundImage !== "none";
        if (!painted) continue;
        corners.push(`${describe(card)} ${name}: ${describe(hit)} paints a square corner`);
        break;
      }
    }

    const w = window as unknown as { __cls?: number; __shifts?: string[] };
    return {
      horizontalOverflow,
      clipped: [...new Set(clipped)].slice(0, 20),
      small: [...new Set(small)].slice(0, 30),
      overlaps,
      corners: [...new Set(corners)],
      cls: Math.round((w.__cls ?? 0) * 1000) / 1000,
      shifts: (w.__shifts ?? []).slice(0, 8),
    };
  }, [scope, includeFloating] as const);
}

export async function axe(page: Page, include?: string): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.nodes
        .slice(0, 4)
        .map((node) => node.target.join(" "))
        .join(" | ")}${violation.nodes.length > 4 ? ` +${violation.nodes.length - 4}` : ""}`,
  );
}

/** The overlays antd draws, open right now. */
export const OVERLAY =
  ".ant-modal-wrap:not([style*='display: none']) .ant-modal, .ant-drawer-open .ant-drawer-content-wrapper, .ant-dropdown:not(.ant-dropdown-hidden), .ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-popover:not(.ant-popover-hidden), .ant-picker-dropdown:not(.ant-picker-dropdown-hidden)";

/** Antd's overlays plus any of the product's own dialogs (palette, sheets, tour). */
export const ANY_OVERLAY = `${OVERLAY}, [role="dialog"]:visible, .nx-sheet:visible`;

export async function openOverlays(page: Page): Promise<number> {
  return page.locator(ANY_OVERLAY).count();
}
