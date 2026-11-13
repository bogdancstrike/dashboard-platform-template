import type { AutomationAction } from "@/api/automations";

/** Placeholders an action's wording may use, stated where somebody types it. */
export const PLACEHOLDERS = "{record} · {rule} · {link}";

/**
 * Whether an action can actually run, and why not when it cannot.
 *
 * Pure, and exported so the tests can state the rule directly rather than
 * through a form: an action that reaches nobody is the one mistake this editor
 * exists to prevent, and it is worth asserting without a browser.
 */
export function actionProblem(
  action: AutomationAction,
  needs: string[],
): string | null {
  if (needs.includes("recipients")) {
    const to = action.recipients;
    if (!to || (to.user_ids.length === 0 && !to.role && !to.owner)) {
      return "Say who this reaches.";
    }
  }
  if (needs.includes("url") && !/^https?:\/\/.+/.test(action.url ?? "")) {
    return "A webhook needs a full http:// or https:// address.";
  }
  return null;
}

/** An empty action of one kind, with the recipient shape already in place. */
export function blankAction(kind: string): AutomationAction {
  return {
    kind: kind as AutomationAction["kind"],
    recipients: { user_ids: [], role: "", owner: true },
  };
}
