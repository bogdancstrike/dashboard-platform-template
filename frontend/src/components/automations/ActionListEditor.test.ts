import { describe, expect, it } from "vitest";

import { actionProblem, blankAction } from "@/components/automations/ActionListEditor";
import type { AutomationAction } from "@/api/automations";

/**
 * What makes one action runnable (§49, §76).
 *
 * Asserted as a function rather than through the form, for two reasons. The
 * rule is the same one `services/workflows._validated_actions` enforces, so it
 * deserves a statement of its own; and driving three AntD selects to clear a
 * recipient tests the library rather than the rule. The editor renders the
 * result of this function beside the field that fixes it, and the wizard's
 * Next button reads the same answer — one source, so the disabled state and
 * its explanation cannot drift apart.
 */
describe("whether an action can run", () => {
  const action = (overrides: Partial<AutomationAction> = {}): AutomationAction => ({
    kind: "NOTIFY",
    ...overrides,
  });

  it("refuses a notification addressed at nobody — the mistake this exists for", () => {
    expect(actionProblem(action({ recipients: { user_ids: [], role: "", owner: false } }), ["recipients"]))
      .toBe("Say who this reaches.");
  });

  it("accepts a role on its own, because that is the option that matters", () => {
    // An alert addressed by enumerating people silently misses whoever joined
    // the team afterwards.
    expect(
      actionProblem(action({ recipients: { user_ids: [], role: "MANAGER", owner: false } }), [
        "recipients",
      ]),
    ).toBeNull();
  });

  it("accepts named people, and accepts the rule's owner", () => {
    expect(
      actionProblem(action({ recipients: { user_ids: ["user-1"], role: "", owner: false } }), [
        "recipients",
      ]),
    ).toBeNull();
    expect(
      actionProblem(action({ recipients: { user_ids: [], role: "", owner: true } }), [
        "recipients",
      ]),
    ).toBeNull();
  });

  it("refuses a webhook that is not a full http address", () => {
    for (const url of ["", "example.internal/hook", "file:///etc/passwd", "ftp://x/y"]) {
      expect(actionProblem(action({ kind: "WEBHOOK", url }), ["url"])).toMatch(/http/);
    }
    expect(actionProblem(action({ kind: "WEBHOOK", url: "https://x.internal/h" }), ["url"]))
      .toBeNull();
  });

  it("asks nothing of an action that declares no needs", () => {
    // A task needs neither a recipient nor a URL: it has a title to fall back
    // on and the queue takes it unassigned. The *server's* declaration decides
    // that, and this function reads it rather than knowing it.
    expect(actionProblem(action({ kind: "TASK" }), [])).toBeNull();
  });

  it("gives a new action its recipient shape, so the first render is not undefined", () => {
    const fresh = blankAction("NOTIFY");
    expect(fresh.kind).toBe("NOTIFY");
    // Defaulted to the rule's owner: somebody adding a notification almost
    // always wants to be told, and an action that starts invalid reads as a
    // form that is already complaining.
    expect(fresh.recipients).toEqual({ user_ids: [], role: "", owner: true });
    expect(actionProblem(fresh, ["recipients"])).toBeNull();
  });
});
