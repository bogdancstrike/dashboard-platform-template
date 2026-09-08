import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import WorkflowsPage, { firingSummary } from "@/pages/WorkflowsPage";
import { CommandProvider } from "@/commands/CommandContext";
import type { AutomationRule } from "@/api/automations";
import { automationRules, resetAutomations } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

/**
 * Automations (§49).
 *
 * What is worth asserting is what makes the page trustworthy: that the list
 * distinguishes a rule that fires from one that never has, that the *server's*
 * rendering of the condition is what appears (not a summary the browser
 * invented), that pausing is one click, that a dry run says what it would do
 * without doing it, and that a rule somebody else owns refuses with its reason
 * rather than pretending to be editable (§76).
 */
function render(route = "/workflows") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/workflows" element={<WorkflowsPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => resetAutomations());

describe("how a rule reports itself", () => {
  const rule = (overrides: Partial<AutomationRule>) =>
    ({ trigger_count: 0, enabled: true, last_triggered_at: null, ...overrides }) as AutomationRule;

  it("says never fired, quietly — a rare event should be silent", () => {
    // Quiet is a tone, not a warning: a rule guarding against something that
    // has not happened is working.
    expect(firingSummary(rule({}))).toEqual({ text: "Never fired", quiet: true });
  });

  it("says so when a paused rule has also never fired", () => {
    expect(firingSummary(rule({ enabled: false })).text).toBe("Never fired · paused");
  });

  it("counts the fires and names the last one", () => {
    const summary = firingSummary(
      rule({ trigger_count: 12, last_triggered_at: "2026-09-07T09:00:00Z" }),
    );
    expect(summary.quiet).toBe(false);
    expect(summary.text).toMatch(/^12 times · last /);
  });

  it("gets the singular right, because 1 times reads as a bug", () => {
    expect(firingSummary(rule({ trigger_count: 1 })).text).toBe("1 time");
    expect(
      firingSummary(rule({ trigger_count: 1, last_triggered_at: "2026-09-07T09:00:00Z" })).text,
    ).toMatch(/^1 time · last /);
  });
});

describe("the automations page", () => {
  it("lists every rule with what it watches and what it does", async () => {
    render();

    const list = await screen.findByTestId("automation-list");
    expect(within(list).getByText("New tasks need triage")).toBeInTheDocument();
    expect(within(list).getByText("Critical tickets breaching")).toBeInTheDocument();
    // What it does, from the server's summary of the declared actions.
    expect(within(list).getAllByText("Notify people").length).toBeGreaterThan(0);
    expect(within(list).getByText("Raise a task")).toBeInTheDocument();
  });

  it("shows the condition as the server compiled it, not a browser summary", async () => {
    render();

    await screen.findByTestId("automation-list");
    // The whole point of §51: the sentence in the list is the shape of the SQL.
    expect(screen.getAllByText("Status in ['NEW']").length).toBeGreaterThan(0);
  });

  it("distinguishes a rule that fires from one that never has", async () => {
    render();

    await screen.findByTestId("automation-list");
    expect(screen.getByText("Never fired")).toBeInTheDocument();
    expect(screen.getByText(/^12 times · last/)).toBeInTheDocument();
  });

  it("pauses a rule from the row, in one click", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("automation-list");
    // Stopping a noisy automation is the most urgent thing on this page.
    await user.click(screen.getByRole("switch", { name: "Pause New tasks need triage" }));

    await waitFor(() =>
      expect(automationRules.find((item) => item["id"] === "rule-1")?.["enabled"]).toBe(false),
    );
  });

  it("offers no switch for a rule somebody else owns", async () => {
    render();

    await screen.findByTestId("automation-list");
    // Absent controls would be a lie; a *disabled* one with the reason is the
    // platform's rule (§76) — so the switch is there and refuses.
    const own = screen.getByRole("switch", { name: "Pause New tasks need triage" });
    const other = screen.getByRole("switch", { name: "Enable Somebody else's rule" });
    expect(own).toBeEnabled();
    expect(other).toBeDisabled();
  });

  it("explains a rule that outlived its dataset, rather than reporting symptoms", async () => {
    render();

    await screen.findByTestId("automation-list");
    // One fact — the dataset is gone — said once. Its empty action list and
    // its uncompilable condition are consequences, and shouting about those
    // as faults sends somebody looking for a bug in an obsolete rule.
    expect(screen.getByText("job · gone")).toBeInTheDocument();
  });

  it("narrows to the paused ones in the address, so a filtered view is a link", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("automation-list");
    await user.click(screen.getByTitle("Paused"));

    await waitFor(() =>
      expect(screen.queryByText("New tasks need triage")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Somebody else's rule")).toBeInTheDocument();
  });

  it("rehearses from the row and reports the three numbers", async () => {
    const user = userEvent.setup();
    render();

    await screen.findByTestId("automation-list");
    await user.click(screen.getByRole("button", { name: "Actions for New tasks need triage" }));
    await user.click(await screen.findByText("Dry run"));

    // Matched, would fire, held back — one count would hide the difference
    // between "nothing matched" and "the cooldown kept quiet".
    expect(
      await screen.findByText("3 matched, 2 would fire, 1 held back."),
    ).toBeInTheDocument();
  });
});

describe("a rule opened", () => {
  async function open(name = "New tasks need triage") {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("automation-list");
    await user.click(screen.getByText(name));
    return { user, drawer: await screen.findByRole("dialog") };
  }

  it("carries the server's compiled condition beside the editor", async () => {
    const { drawer } = await open();
    // Read from the server rather than rendered here: an inspector that
    // computes its own text is a second opinion (§51).
    expect(within(drawer).getByTestId("condition-text")).toHaveTextContent("Status in ['NEW']");
  });

  it("dry-runs without firing, and shows what would have happened", async () => {
    const { user, drawer } = await open();
    await user.click(within(drawer).getByTestId("dry-run"));

    const report = await screen.findByTestId("run-report");
    expect(within(report).getByText("Would fire")).toBeInTheDocument();
    // One record would fire and one is held back — the cooldown working, and
    // named as such rather than looking like a failure.
    expect(within(report).getByText("would fire")).toBeInTheDocument();
    expect(within(report).getByText("suppressed")).toBeInTheDocument();
  });

  it("asks before firing for real, and says what that will do", async () => {
    const { user, drawer } = await open();
    await user.click(within(drawer).getByTestId("run-for-real"));

    // `findAllByText`: AntD's confirm renders its title twice, once for the
    // screen reader, so the singular query is ambiguous by construction.
    expect(await screen.findAllByText("Run it for real?")).not.toHaveLength(0);
    expect(
      screen.getAllByText(/notifications sent, tasks raised, webhooks called/),
    ).not.toHaveLength(0);
  });

  it("will not offer a real run on a paused rule", async () => {
    const { drawer } = await open("Somebody else's rule");
    // A paused rule may be rehearsed — that is how somebody decides to switch
    // it on — but not fired.
    expect(within(drawer).getByTestId("dry-run")).toBeEnabled();
    expect(within(drawer).queryByTestId("run-for-real")).not.toBeInTheDocument();
  });

  it("says which records it is holding back, and until when", async () => {
    const { user, drawer } = await open();
    await user.click(within(drawer).getByTitle("Held back (1)"));

    // The answer to "why has it gone quiet", which is the question a working
    // automation gets asked most.
    const table = await screen.findByTestId("cooling-down");
    expect(within(table).getByText("TSK-00002 Chase the invoice")).toBeInTheDocument();
  });

  it("says a rule with no cooldown holds nothing back, rather than showing an empty table", async () => {
    const { user, drawer } = await open("Critical tickets breaching");
    await user.click(within(drawer).getByTitle("Held back (0)"));

    expect(await screen.findByText("This automation has no cooldown")).toBeInTheDocument();
  });

  it("edits an action, through the catalogue the server published", async () => {
    const { user, drawer } = await open();
    await user.click(within(drawer).getByTitle("Then (1)"));

    const actions = await screen.findByTestId("action-list");
    // The kinds offered are the server's, so the form cannot ask for a field
    // nothing reads (§76).
    expect(within(actions).getByTestId("add-action-WEBHOOK")).toBeInTheDocument();
    await user.click(within(actions).getByTestId("add-action-TASK"));

    await waitFor(() =>
      expect(
        (automationRules.find((item) => item["id"] === "rule-1")?.["actions"] as unknown[])
          .length,
      ).toBe(2),
    );
  });

  it("withdraws a rule, saying what that does and does not undo", async () => {
    const { user, drawer } = await open();
    await user.click(within(drawer).getByTestId("delete-automation"));

    expect(await screen.findAllByText("Withdraw New tasks need triage?")).not.toHaveLength(0);
    expect(
      screen.getAllByText(/nothing it has already sent is undone/),
    ).not.toHaveLength(0);
  });
});
