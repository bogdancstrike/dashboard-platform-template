/**
 * How an audit action is named and coloured, decided once.
 *
 * The ledger, the drawer and the per-record timeline all render the same
 * actions, and an action that is red in the table and blue in the timeline
 * makes the reader check whether it is the same action. Colour follows what
 * the action *did* rather than the entity it did it to: destruction is red,
 * creation is green, a privilege change is the one that should catch an
 * auditor's eye.
 */
const DESTRUCTIVE = new Set([
  "DELETE",
  "BULK_DELETE",
  "CREDENTIAL_REVOKE",
  "SESSION_REVOKE",
  "JOB_CANCEL",
]);

const CREATIVE = new Set(["CREATE", "UPLOAD", "IMPORT", "CREDENTIAL_CREATE", "COMMENT"]);

const PRIVILEGED = new Set([
  "PERMISSION_CHANGE",
  "CONFIGURATION_CHANGE",
  "IMPERSONATE",
  "CREDENTIAL_ROTATE",
  "SHARE",
]);

const SESSION = new Set(["LOGIN", "LOGOUT", "LOGIN_FAILED"]);

export function actionColor(action: string | null | undefined): string {
  const key = String(action ?? "").toUpperCase();
  if (DESTRUCTIVE.has(key)) return "red";
  if (PRIVILEGED.has(key)) return "purple";
  if (CREATIVE.has(key)) return "green";
  if (SESSION.has(key)) return "cyan";
  if (key.startsWith("BULK")) return "orange";
  if (key === "EXPORT" || key === "DOWNLOAD") return "gold";
  return "blue";
}

/** "PERMISSION_CHANGE" → "Permission change". */
export function humaniseAction(action: string | null | undefined): string {
  const text = String(action ?? "").replace(/_/g, " ").toLowerCase();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "";
}

/** The colour a result gets in a tag. Only failure states earn one. */
export function resultColor(result: string | null | undefined): string | undefined {
  switch (String(result ?? "").toUpperCase()) {
    case "FAILURE":
      return "red";
    case "DENIED":
      return "orange";
    case "PARTIAL":
      return "gold";
    default:
      return undefined;
  }
}
