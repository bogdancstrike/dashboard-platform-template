// Scripted flows that change data — always on throwaway rows this script
// creates (named "zzauditB …") and removes again. Each flow screenshots every
// state and records console errors / failed requests.
//   node e2e/audit-b/flows.mjs [--only records,bulk,views,explorer,admin] [--device pc] [--theme light]
import fs from "node:fs";
import path from "node:path";
import { BASE, OUT, SHOTS, axe, context, launch, settle, slug, watch } from "./lib.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const only = opt("only", "records,bulk,views,explorer,admin").split(",");
const device = opt("device", "pc");
const theme = opt("theme", "light");
const STAMP = `zzauditB ${Date.now().toString(36)}`;

const browser = await launch();
const ctx = await context(browser, { device, theme });
const report = [];
let step = 0;

async function shot(page, name) {
  step++;
  const file = `auditB_flow_${String(step).padStart(2, "0")}_${slug(name)}_${device}_${theme}.png`;
  await page.screenshot({ path: path.join(SHOTS, file) }).catch(() => undefined);
  return file;
}

async function flow(name, fn) {
  const page = await ctx.newPage();
  const log = watch(page);
  const notes = [];
  const note = (m) => {
    notes.push(m);
    console.log(`  [${name}] ${m}`);
  };
  try {
    await fn(page, note);
  } catch (e) {
    note(`FAILED: ${String(e.message).split("\n")[0]}`);
    await shot(page, `${name}-failure`);
  }
  report.push({ flow: name, notes, console: log.console, pageErrors: log.pageErrors, http: log.http.filter((h) => !/ 401 | 403 /.test(h)) });
  await page.close();
}

async function go(page, route) {
  await page.goto(BASE + route);
  await page.waitForSelector("#nu-main", { timeout: 60_000 });
  await settle(page, 600);
}

const modal = (page) => page.locator(".ant-modal-wrap:not([style*='display: none']) .ant-modal").filter({ visible: true }).last();
const drawer = (page) => page.locator(".ant-drawer-open .ant-drawer-content").filter({ visible: true }).last();

/** Fill every required field of the record form with something valid. */
async function fillRequired(page, root) {
  const items = root.locator(".ant-form-item").filter({ has: page.locator(".ant-form-item-required") });
  const n = await items.count();
  for (let i = 0; i < n; i++) {
    const item = items.nth(i);
    const label = (await item.locator("label").first().innerText().catch(() => "")).trim();
    if (await item.locator(".ant-select").count()) {
      await item.locator(".ant-select-selector").click();
      await page.waitForTimeout(400);
      const opt = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first();
      if (await opt.count()) await opt.click();
      else await page.keyboard.press("Escape");
    } else if (await item.locator(".ant-picker").count()) {
      await item.locator(".ant-picker input").first().click();
      await page.locator(".ant-picker-dropdown:not(.ant-picker-dropdown-hidden) .ant-picker-today-btn, .ant-picker-dropdown:not(.ant-picker-dropdown-hidden) .ant-picker-now-btn").first().click().catch(async () => {
        await page.keyboard.press("Escape");
      });
    } else if (await item.locator(".ant-input-number").count()) {
      await item.locator("input").first().fill("1");
    } else if (await item.locator("textarea").count()) {
      await item.locator("textarea").first().fill(`${STAMP} ${label}`);
    } else if (await item.locator("input").count()) {
      const type = await item.locator("input").first().getAttribute("type");
      await item.locator("input").first().fill(type === "email" || /mail/i.test(label) ? `zzauditb+${Date.now()}@example.com` : `${STAMP} ${label}`.slice(0, 60));
    }
  }
}

// ── records: create (validation first), edit, history/restore, comment, delete ──
if (only.includes("records")) {
  for (const entity of ["customers", "tickets"]) {
    await flow(`record-${entity}`, async (page, note) => {
      await go(page, `/${entity}`);
      await page.getByTestId("record-create").first().click().catch(async () => {
        await page.getByRole("button", { name: /^New / }).first().click();
      });
      const form = modal(page);
      await form.waitFor();
      await shot(page, `${entity}-form-open`);
      // Submit empty: every required field must say so, nothing is sent.
      await page.getByTestId("record-form-save").click();
      await page.waitForTimeout(600);
      const errs = await form.locator(".ant-form-item-explain-error").count();
      note(`empty submit shows ${errs} field errors`);
      await shot(page, `${entity}-form-validation`);
      await fillRequired(page, form);
      await shot(page, `${entity}-form-filled`);
      await page.getByTestId("record-form-save").click();
      await page.waitForURL(new RegExp(`/${entity}/[0-9a-f-]{36}`), { timeout: 20_000 });
      await settle(page, 800);
      const id = page.url().match(/[0-9a-f-]{36}/)[0];
      note(`created ${id}`);
      await shot(page, `${entity}-created`);
      // Edit
      await page.getByTestId("record-edit").click();
      const edit = modal(page);
      await edit.waitFor();
      const firstText = edit.locator(".ant-form-item input.ant-input").first();
      await firstText.fill(`${STAMP} edited`);
      await page.getByTestId("record-form-save").click();
      await edit.waitFor({ state: "hidden", timeout: 15_000 });
      await settle(page, 600);
      await shot(page, `${entity}-edited`);
      // History: versions, compare, restore
      const historyTab = page.getByRole("tab", { name: "History" });
      if (await historyTab.count()) await historyTab.click();
      else await page.locator(".ant-card").filter({ hasText: /^History/ }).getByRole("button").first().click();
      await settle(page, 600);
      await shot(page, `${entity}-history`);
      const restore = page.getByRole("button", { name: /^Restore v\d/ }).first();
      if (await restore.count()) {
        await restore.click();
        await page.waitForTimeout(500);
        await shot(page, `${entity}-restore-confirm`);
        const ok = page.locator(".ant-popconfirm .ant-btn-primary, .ant-modal-confirm .ant-btn-primary, .ant-modal .ant-btn-primary").filter({ visible: true }).last();
        if (await ok.count()) {
          await ok.click();
          await settle(page, 800);
          note("restored a version");
          await shot(page, `${entity}-restored`);
        }
      } else note("no Restore control on History");
      // Conversation
      const convo = page.getByRole("tab", { name: /Conversation/ });
      if (await convo.count()) {
        await convo.click();
        await settle(page, 400);
        const box = page.locator("#nu-main textarea").first();
        if (await box.count()) {
          await box.fill(`${STAMP} a comment`);
          await page.getByRole("button", { name: /^(Post|Comment|Send|Reply)/ }).first().click();
          await settle(page, 600);
          note(`comment posted: ${await page.getByText(`${STAMP} a comment`).count()}`);
          await shot(page, `${entity}-comment`);
        }
      }
      // Escape a preview drawer / back button
      await page.getByRole("button", { name: "Delete" }).first().click();
      await page.waitForTimeout(500);
      await shot(page, `${entity}-delete-confirm`);
      await page.locator(".ant-popconfirm .ant-btn-dangerous, .ant-popconfirm .ant-btn-primary, .ant-modal-confirm .ant-btn-dangerous, .ant-modal .ant-btn-dangerous").filter({ visible: true }).last().click();
      await page.waitForURL(new RegExp(`/${entity}(\\?|$)`), { timeout: 15_000 });
      note("deleted, back on the list");
      await shot(page, `${entity}-after-delete`);
    });
  }
}

// ── bulk bar, bulk dialog (preview + cancel), compare ──
if (only.includes("bulk")) {
  await flow("bulk", async (page, note) => {
    await go(page, "/tickets");
    const boxes = page.locator(".ant-table-tbody tr.ant-table-row .ant-checkbox-wrapper");
    if (!(await boxes.count())) {
      note("no row checkboxes — bulk-operations is switched off for this reader");
      return;
    }
    await boxes.nth(0).click();
    await boxes.nth(1).click();
    await page.getByTestId("bulk-bar").waitFor();
    note(`bulk bar: ${await page.getByTestId("bulk-count").innerText()}`);
    await shot(page, "bulk-bar");
    await page.getByTestId("bulk-update").click();
    const dialog = page.locator(".nx-rec-bulkmodal .ant-modal-content").filter({ visible: true });
    await dialog.waitFor();
    await page.waitForTimeout(400);
    // Choose a value so the preview runs.
    const value = page.getByTestId("bulk-value");
    if (await value.count()) {
      await value.click();
      const opt = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first();
      if (await opt.count()) await opt.click();
      else await value.locator("input").fill("x").catch(() => undefined);
    }
    await page.getByTestId("bulk-preview").waitFor({ timeout: 10_000 }).catch(() => note("no preview shown"));
    await shot(page, "bulk-dialog-preview");
    const ax = await axe(page);
    if (ax.length) note(`axe in bulk dialog: ${ax.map((v) => v.id).join(", ")}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    note(`dialog closed by Escape: ${!(await dialog.isVisible().catch(() => false))}`);
    await page.getByTestId("bulk-compare").click();
    await page.waitForURL(/\/compare/);
    await settle(page, 800);
    await shot(page, "compare");
    await page.goBack();
    await settle(page, 600);
    note(`back from compare lands on ${page.url().replace(BASE, "")}`);
    const clear = page.getByTestId("bulk-clear");
    if (await clear.isVisible().catch(() => false)) await clear.click();
    // Select all on the page, then the over-limit / filter selection.
    const all = page.locator(".ant-table-thead tr:not(.ant-table-measure-row) .ant-checkbox-wrapper").first();
    await all.click();
    await page.waitForTimeout(300);
    await shot(page, "bulk-select-page");
    const everything = page.getByTestId("bulk-select-all");
    if (await everything.count()) {
      await everything.click();
      await page.waitForTimeout(300);
      note(`select-all-matching: ${await page.getByTestId("bulk-count").innerText()}`);
      await shot(page, "bulk-select-all");
    }
    await page.getByTestId("bulk-clear").click();
  });
}

// ── saved views: save, apply, delete ──
if (only.includes("views")) {
  await flow("saved-views", async (page, note) => {
    await go(page, "/orders?f.status=CONFIRMED");
    await page.getByTestId("saved-views").click();
    await page.waitForTimeout(400);
    await shot(page, "views-menu");
    const save = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) [role=menuitem]").filter({ hasText: /Save/ }).first();
    await save.click();
    const box = modal(page);
    await box.waitFor();
    await box.locator("input").first().fill(`${STAMP} view`);
    await shot(page, "views-save-dialog");
    await box.locator(".ant-btn-primary").click();
    await box.waitFor({ state: "hidden" });
    await settle(page, 500);
    await go(page, "/orders");
    await page.getByTestId("saved-views").click();
    await page.locator(".ant-dropdown:not(.ant-dropdown-hidden) [role=menuitem]").filter({ hasText: `${STAMP} view` }).first().click();
    await settle(page, 600);
    note(`applied view -> ${page.url().replace(BASE, "")}`);
    await shot(page, "views-applied");
    await page.getByTestId("saved-views").click();
    await page.waitForTimeout(400);
    const del = page.locator(".ant-dropdown:not(.ant-dropdown-hidden) [role=menuitem]").filter({ hasText: /Delete|Remove|Forget/ }).first();
    if (await del.count()) {
      await del.click();
      await page.waitForTimeout(400);
      const ok = page.locator(".ant-popconfirm .ant-btn-primary, .ant-modal-confirm .ant-btn-primary, .ant-modal .ant-btn-dangerous").filter({ visible: true }).last();
      if (await ok.count()) await ok.click();
      await settle(page, 500);
      note("deleted the view");
    } else note("no delete in the views menu");
    await shot(page, "views-after-delete");
  });
}

// ── Data Explorer: modes, columns, rules drawer w/ groups, ask, saved searches ──
if (only.includes("explorer")) {
  await flow("explorer", async (page, note) => {
    await go(page, "/explore");
    for (const mode of ["List", "Cards", "Compact", "Table"]) {
      const b = page.locator("#nu-main .ant-segmented-item").filter({ hasText: new RegExp(`^${mode}$`) }).first();
      if (await b.count()) {
        await b.click();
        await settle(page, 300);
        await shot(page, `explorer-${mode}`);
      }
    }
    await page.getByRole("button", { name: /Columns/ }).first().click();
    await page.waitForTimeout(500);
    await shot(page, "explorer-columns");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Rules/ }).first().click();
    const d = drawer(page);
    await d.waitFor();
    await shot(page, "explorer-rules-drawer");
    await d.getByRole("button", { name: /add a condition/i }).first().click();
    await page.waitForTimeout(300);
    await d.getByRole("button", { name: /add a group/i }).first().click();
    await page.waitForTimeout(300);
    // A condition inside the new group: the nested case.
    const inner = d.locator(".group .group").first();
    if (await inner.count()) await inner.getByRole("button", { name: /add a condition/i }).first().click().catch(() => undefined);
    // Describe-what-you-want: the AI filter box (no Build without text).
    const describe = d.locator("input[placeholder*='critical tickets']").first();
    if (await describe.count()) {
      await describe.fill("open critical tickets created this month");
      await shot(page, "explorer-describe-filled");
    }
    await page.waitForTimeout(500);
    note(`rules: ${await d.locator(".rule").count()} groups: ${await d.locator(".group").count()}`);
    await shot(page, "explorer-rules-nested");
    const ax = await axe(page);
    if (ax.length) note(`axe in rules drawer: ${ax.map((v) => `${v.id}(${v.n})`).join(", ")}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    note(`drawer closed by Escape: ${!(await d.isVisible().catch(() => false))}`);
    await page.getByRole("button", { name: /^Ask/ }).first().click();
    await page.waitForTimeout(500);
    await shot(page, "explorer-ask");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Saved searches/ }).first().click();
    await page.waitForTimeout(600);
    await shot(page, "explorer-saved-searches");
    await page.keyboard.press("Escape");
    // A search with no answer: the empty state.
    await page.locator("#nu-main input[type=search], #nu-main .ant-input").first().fill("zzzz-nothing-matches-this");
    await page.keyboard.press("Enter");
    await settle(page, 600);
    await shot(page, "explorer-empty");
  });
}

// ── admin: create + delete throwaway group, tag, flag, api client; open service modal ──
if (only.includes("admin")) {
  const creators = [
    { route: "/admin/groups", open: /New group/, name: "group" },
    { route: "/admin/tags", open: /New tag/, name: "tag" },
    { route: "/admin/flags", open: /Add one/, name: "flag" },
    { route: "/admin/api", open: /Register a client/, name: "client" },
  ];
  for (const c of creators) {
    await flow(`admin-${c.name}`, async (page, note) => {
      await go(page, c.route);
      await page.getByRole("button", { name: c.open }).first().click();
      const box = page.locator(".ant-modal-wrap:not([style*='display: none']) .ant-modal, .ant-drawer-open .ant-drawer-content").filter({ visible: true }).last();
      await box.waitFor();
      await shot(page, `${c.name}-new`);
      // Submit empty first.
      await box.locator(".ant-btn-primary").last().click();
      await page.waitForTimeout(500);
      note(`empty submit errors: ${await box.locator(".ant-form-item-explain-error").count()}`);
      await shot(page, `${c.name}-new-validation`);
      const name = `${STAMP.replace(/ /g, "-")}-${c.name}`.toLowerCase();
      // Every empty text box in the dialog gets the throwaway name (a hex
      // where the box wants a colour); required selects get their first option.
      const boxes = box.locator("input.ant-input:not([type=search]), input[type=text]:not(.ant-select-selection-search-input)").filter({ visible: true });
      const n = await boxes.count();
      for (let i = 0; i < n; i++) {
        const el = boxes.nth(i);
        if ((await el.inputValue().catch(() => "x")) !== "") continue;
        const hint = `${(await el.getAttribute("placeholder")) ?? ""} ${(await el.getAttribute("id")) ?? ""}`;
        await el.fill(/#|hex|colou?r/i.test(hint) ? "#2457d6" : name.replace(/[^a-z0-9-]/g, "-").slice(0, 40));
      }
      const selects = box.locator(".ant-form-item").filter({ has: page.locator(".ant-form-item-required") }).locator(".ant-select-selector");
      for (let i = 0; i < (await selects.count()); i++) {
        await selects.nth(i).click();
        await page.waitForTimeout(300);
        await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click().catch(() => page.keyboard.press("Escape"));
      }
      await box.locator(".ant-btn-primary").last().click();
      await page.waitForTimeout(1200);
      await shot(page, `${c.name}-created`);
      const still = await box.isVisible().catch(() => false);
      if (still) {
        note(`dialog still open after submit: ${(await box.locator(".ant-form-item-explain-error").allInnerTexts()).join(" | ")}`);
        await page.keyboard.press("Escape");
      }
      await settle(page, 600);
      const row = page.locator("#nu-main").getByText(name.replace(/[^a-z0-9-]/g, "-").slice(0, 40)).first();
      note(`row visible: ${await row.count()}`);
    });
  }
  await flow("admin-health-service", async (page, note) => {
    await go(page, "/admin/health");
    const svc = page.locator("#nu-main").getByText(/PostgreSQL|Redis/).first();
    await svc.click();
    await page.waitForTimeout(700);
    await shot(page, "health-service-modal");
    const ax = await axe(page);
    if (ax.length) note(`axe: ${ax.map((v) => v.id).join(", ")}`);
    await page.keyboard.press("Escape");
  });
}

await browser.close();
const file = path.join(OUT, `flows-${device}-${theme}.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 1));
console.log("wrote", file);
