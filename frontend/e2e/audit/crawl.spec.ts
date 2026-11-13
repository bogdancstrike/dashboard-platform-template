import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { test, type Page } from "@playwright/test";

import { storageStateFor } from "../auth";
import {
  axe,
  collect,
  measure,
  openOverlays,
  pinTheme,
  settle,
  VIEWPORTS,
  watchLayoutShift,
  type Device,
  type Theme,
} from "./probe";
import { resolve, ROUTES } from "./routes";

/**
 * The full UI audit: every route × pc/tablet/phone × light/dark, measured and
 * screenshotted, then every safe control on it opened and used.
 *
 * Opt-in (`AUDIT_FULL=1`) because it is a crawl rather than a test: it takes
 * half an hour, writes a JSON report and a few hundred screenshots to
 * `AUDIT_OUT`, and does not fail on what it finds — `smoke.spec.ts` is the
 * gate, and this is the microscope that feeds it.
 *
 *   AUDIT_FULL=1 AUDIT_OUT=/tmp/audit BASE_URL=http://localhost:8090 \
 *     npx playwright test e2e/audit/crawl.spec.ts
 */

const FULL = !!process.env["AUDIT_FULL"];
const OUT = process.env["AUDIT_OUT"] ?? "test-results/audit";
const DEVICES = (process.env["AUDIT_DEVICES"] ?? "pc,tablet,phone").split(",") as Device[];
const THEMES = (process.env["AUDIT_THEMES"] ?? "light,dark").split(",") as Theme[];
const ONLY = process.env["AUDIT_ONLY"]?.split(",");
const INTERACT_ON = (process.env["AUDIT_INTERACT"] ?? "pc:light,phone:light,pc:dark").split(",");

test.skip(!FULL, "the full crawl is opt-in: AUDIT_FULL=1");
test.describe.configure({ mode: "parallel" });
test.setTimeout(15 * 60_000);

/** A button whose words say it changes or destroys something is never pressed by the crawl. */
const UNSAFE =
  /delete|remove|archive|leave|sign out|log ?out|reject|approve|decline|accept|send|submit|save|publish|revoke|disable|reset|clear|restore|discard|run now|test run|mark all|dismiss|stop|close sprint|start sprint|complete|impersonat|regenerate|rotate|merge|unsubscribe|mute|follow|pin|unpin|star|favou?rite|react|vote|refresh|retry|upload|import|export|download|print|copy|duplicate|log time|start timer|join|withdraw|cancel|undo|redo|tidy|apply|generate|ask|create|add$|rescore|recompute|snooze|resolve|acknowledge|enable|toggle|switch|full ?screen/i;

type Finding = Record<string, unknown>;

async function shot(page: Page, name: string): Promise<string> {
  const path = join(OUT, "shots", `${name}.png`);
  await page.screenshot({ path }).catch(() => undefined);
  return path;
}

async function closeOverlay(page: Page, url: string): Promise<string | null> {
  const before = await openOverlays(page);
  if (before === 0) {
    if (page.url() !== url) {
      await page.goBack().catch(() => undefined);
      await page.waitForTimeout(400);
      if (page.url() !== url) {
        await page.goto(url);
        return "navigated away and Back did not return";
      }
    }
    return null;
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(450);
  if ((await openOverlays(page)) < before) return null;
  const close = page.locator(".ant-modal-close:visible, .ant-drawer-close:visible").first();
  if (await close.count()) {
    await close.click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(450);
    if ((await openOverlays(page)) < before) return "Esc did not close it (× did)";
  }
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);
  return (await openOverlays(page)) < before ? "Esc did not close it (outside click did)" : "could not be closed";
}

/**
 * Every control a reader can use without changing data: tabs, segmented
 * filters, selects, menus, and buttons whose words open something.
 */
async function interact(page: Page, tag: string, url: string, log: Finding[], used: string[], pick = true): Promise<void> {
  const handles = await page.evaluate((unsafeSource) => {
    const unsafe = new RegExp(unsafeSource, "i");
    const main = document.querySelector("main, .nx-main, .nx-content") ?? document.body;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const seen = new Set<string>();
    const out: { selector: string; label: string; kind: string }[] = [];
    let n = 0;
    const add = (el: Element, kind: string) => {
      if (!visible(el) || el.closest("[aria-disabled=true], .ant-select-disabled, [disabled]")) return;
      const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
      const key = `${kind}:${label}`;
      if (seen.has(key)) return;
      if (kind === "button" && (!label || unsafe.test(label))) return;
      seen.add(key);
      el.setAttribute("data-audit-id", String(++n));
      out.push({ selector: `[data-audit-id="${n}"]`, label, kind });
    };
    main.querySelectorAll('[role="tab"]:not([aria-selected="true"])').forEach((el) => add(el, "tab"));
    main.querySelectorAll(".ant-segmented-item:not(.ant-segmented-item-selected)").forEach((el) => add(el, "segmented"));
    main.querySelectorAll(".ant-select:not(.ant-select-disabled)").forEach((el) => add(el, "select"));
    main.querySelectorAll(".ant-picker:not(.ant-picker-disabled)").forEach((el) => add(el, "picker"));
    main.querySelectorAll(".ant-dropdown-trigger, [aria-haspopup='menu']").forEach((el) => add(el, "menu"));
    main.querySelectorAll("button").forEach((el) => add(el, "button"));
    return out.slice(0, 40);
  }, UNSAFE.source);

  for (const control of handles) {
    const errorsBefore = log.length;
    const target = page.locator(control.selector);
    if (!(await target.count())) continue;
    try {
      await target.first().scrollIntoViewIfNeeded({ timeout: 2000 });
      await target.first().click({ timeout: 3000 });
    } catch (error) {
      log.push({ control, problem: `could not be clicked: ${String(error).split("\n")[0]}` });
      continue;
    }
    await page.waitForTimeout(600);
    const overlays = await openOverlays(page);
    used.push(`${control.kind}: ${control.label}${overlays ? " (opened)" : ""}`);
    const slug = `${tag}__${control.kind}-${control.label.replace(/[^a-z0-9]+/gi, "-").slice(0, 30)}`;
    if (overlays > 0 || control.kind === "tab" || control.kind === "segmented") {
      await settle(page, 200);
      const layout = await measure(page, overlays ? ".ant-modal-wrap:not([style*='display: none']), .ant-drawer-open, .ant-dropdown:not(.ant-dropdown-hidden), .ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-popover:not(.ant-popover-hidden), [role=dialog]" : "body");
      const shotPath = await shot(page, slug);
      const problems = [
        layout.horizontalOverflow,
        ...layout.clipped,
        ...layout.overlaps.map((o) => `overlap ${o}`),
        ...layout.corners,
      ].filter(Boolean);
      // A select: pick the second option and see the page survive it.
      // Never on a record's own page, where choosing an option *saves* it.
      if (pick && control.kind === "select" && overlays) {
        const option = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").nth(1);
        if (await option.count()) {
          await option.click({ timeout: 2000 }).catch(() => undefined);
          await page.waitForTimeout(500);
        }
      }
      if (problems.length) log.push({ control, shot: shotPath, problems });
      if (overlays > 0 && (await page.locator(".ant-modal-wrap .ant-modal:visible, .ant-drawer-open").count())) {
        const violations = await axe(page, ".ant-modal-root, .ant-drawer").catch(() => []);
        if (violations.length) log.push({ control, shot: shotPath, axe: violations });
      }
    }
    const closeProblem = await closeOverlay(page, url);
    if (closeProblem && control.kind !== "tab" && control.kind !== "segmented") log.push({ control, problem: closeProblem });
    if (control.kind === "tab" || control.kind === "segmented") {
      if (page.url() !== url) await page.goto(url).catch(() => undefined);
    }
    if (log.length > errorsBefore + 3) break;
  }
}

for (const route of ROUTES) {
  if (ONLY && !ONLY.includes(route.name)) continue;
  for (const device of DEVICES) {
    for (const theme of THEMES) {
      test(`${route.name} ${device} ${theme}`, async ({ browser }) => {
        mkdirSync(join(OUT, "shots"), { recursive: true });
        mkdirSync(join(OUT, "json"), { recursive: true });
        const context = await browser.newContext({
          storageState: storageStateFor("admin"),
          viewport: VIEWPORTS[device],
          colorScheme: theme,
          hasTouch: device === "phone",
        });
        await pinTheme(context, theme);
        await watchLayoutShift(context);
        const page = await context.newPage();
        const found = collect(page);
        const tag = `auditA_${route.name}_${device}_${theme}`;
        const path = await resolve(page, route);
        const report: Finding = { route: route.name, device, theme, path };
        if (!path) {
          report["problem"] = "no record to open";
          writeFileSync(join(OUT, "json", `${tag}.json`), JSON.stringify(report, null, 2));
          await context.close();
          return;
        }
        found.console.length = 0;
        found.requests.length = 0;
        await page.goto(path);
        await page.waitForSelector(".nx-app", { timeout: 60_000 });
        await settle(page, 800);
        report["layout"] = await measure(page);
        report["axe"] = await axe(page).catch((error) => [`axe failed: ${String(error)}`]);
        report["shot"] = await shot(page, tag);
        // The whole page, for what sits below the fold.
        await page.screenshot({ path: join(OUT, "shots", `${tag}_full.png`), fullPage: true }).catch(() => undefined);
        // Scrolled to the end: the last controls must clear the floating chrome.
        await page.evaluate(() => {
          const scroller = document.querySelector("main.nx-scroll") ?? document.scrollingElement;
          scroller?.scrollTo({ top: 1e7 });
        });
        await page.waitForTimeout(400);
        const atEnd = await measure(page, "body", true);
        report["coveredAtEnd"] = atEnd.overlaps.filter((o) => /nx-ai-fab|nx-tab/.test(o));
        await page.evaluate(() => (document.querySelector("main.nx-scroll") ?? document.scrollingElement)?.scrollTo({ top: 0 }));
        report["consoleOnLoad"] = [...found.console];
        report["requestsOnLoad"] = [...found.requests];
        if (INTERACT_ON.includes(`${device}:${theme}`)) {
          const interactions: Finding[] = [];
          const used: string[] = [];
          await interact(page, tag, page.url(), interactions, used, "path" in route);
          report["interactions"] = interactions;
          report["used"] = used;
        }
        report["console"] = found.console;
        report["requests"] = found.requests;
        writeFileSync(join(OUT, "json", `${tag}.json`), JSON.stringify(report, null, 2));
        await context.close();
      });
    }
  }
}
