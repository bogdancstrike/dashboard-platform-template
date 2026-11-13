import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { AutomationAction, AutomationCatalogue } from "@/api/automations";
import { ActionListEditor, blankAction } from "@/components/automations/ActionListEditor";
import { renderWithProviders } from "@/test/render";

/**
 * What an automation does (§23), as a list somebody edits: add an action of
 * each kind, fill the fields that kind needs, see the problem beside the field
 * that fixes it, change a kind, remove one.
 */
const CATALOGUE = {
  resources: [],
  roles: [{ code: "MANAGER", name: "Manager" }],
  actions: [
    { kind: "NOTIFY", label: "Notify people", description: "An in-app notification.", needs: ["recipients"] },
    { kind: "EMAIL", label: "Send an email", description: "Queued into the mailbox.", needs: ["recipients"] },
    { kind: "TASK", label: "Raise a task", description: "In the normal queue.", needs: [] },
    { kind: "WEBHOOK", label: "Call a webhook", description: "One POST.", needs: ["url"] },
  ],
  severities: [],
  priorities: ["LOW", "HIGH", "CRITICAL"],
  limits: { max_matches: 1, max_fires: 1, max_rules: 1 },
} as unknown as AutomationCatalogue;

const seen: { latest: AutomationAction[] } = { latest: [] };

function Harness({ initial, disabled = false }: { initial: AutomationAction[]; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <ActionListEditor
      catalogue={CATALOGUE}
      value={value}
      disabled={disabled}
      onChange={(next) => {
        seen.latest = next;
        setValue(next);
      }}
    />
  );
}

async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  const item = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find(
      (node) => node.textContent === option,
    );
    if (!found) throw new Error(`${option} not offered for ${label}`);
    return found;
  });
  await user.click(item);
}

describe("the action list", () => {
  it("warns that an automation with no actions would do nothing, then adds one of each kind", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={[]} />);
    expect(screen.getByText("This automation would do nothing")).toBeInTheDocument();
    for (const kind of ["NOTIFY", "EMAIL", "TASK", "WEBHOOK"]) await user.click(screen.getByTestId(`add-action-${kind}`));
    expect(seen.latest.map((action) => action.kind)).toEqual(["NOTIFY", "EMAIL", "TASK", "WEBHOOK"]);
    // An email's wording is its subject; a task's is its title.
    expect(screen.getByText("Subject")).toBeInTheDocument();
    expect(screen.getAllByText("Title").length).toBeGreaterThan(0);
  });

  it("fills a notification's audience, a task's wording and priority, and a webhook's address", async () => {
    renderWithProviders(<Harness initial={[{ ...blankAction("NOTIFY"), recipients: { user_ids: [], role: "", owner: false } }, blankAction("TASK"), blankAction("WEBHOOK"), blankAction("EMAIL")]} />);
    // Addressed at nobody: said beside the field.
    expect(screen.getByText("Say who this reaches.")).toBeInTheDocument();
    await choose("Role 1", "Manager");
    await waitFor(() => expect(seen.latest[0]!.recipients?.role).toBe("MANAGER"));
    expect(screen.queryByText("Say who this reaches.")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Wording 2"), { target: { value: "{rule}: chase {record} ✓" } });
    expect(seen.latest[1]!.title).toBe("{rule}: chase {record} ✓");
    await choose("Priority 2", "Critical");
    expect(seen.latest[1]!.priority).toBe("CRITICAL");

    expect(screen.getByText(/full http/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Webhook URL 3"), { target: { value: "https://hooks.example/n" } });
    expect(seen.latest[2]!.url).toBe("https://hooks.example/n");

    fireEvent.change(screen.getByLabelText("Wording 4"), { target: { value: "Heads up" } });
    expect(seen.latest[3]!.subject).toBe("Heads up");
  });

  it("changes an action's kind to a blank one, and removes one", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={[{ ...blankAction("TASK"), title: "Old" }, blankAction("NOTIFY")]} />);
    await choose("Action 1", "Call a webhook");
    expect(seen.latest[0]).toMatchObject({ kind: "WEBHOOK" });
    expect(seen.latest[0]!.title).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Remove action 2" }));
    expect(seen.latest).toHaveLength(1);
  });

  it("stops at eight actions", () => {
    renderWithProviders(<Harness initial={Array.from({ length: 8 }, () => blankAction("TASK"))} />);
    expect(screen.getByTestId("add-action-TASK")).toBeDisabled();
  });

  it("is read-only when disabled", () => {
    renderWithProviders(<Harness initial={[blankAction("TASK")]} disabled />);
    expect(screen.getByLabelText("Wording 1")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove action 1" })).toBeDisabled();
  });
});
