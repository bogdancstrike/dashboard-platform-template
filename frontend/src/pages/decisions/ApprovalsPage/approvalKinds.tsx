import type { Approval, ApprovalScope } from "@/api/approvals";
import { age } from "@/api/approvals";
import { TdIcon, type TdIconName } from "@/components/icons/TdIcon";
import { NxIcon, type NxIconName } from "@/components/NxIcon";

const STATUS_TONE: Record<string, string> = {
  PENDING: "nx-td-pilltag nx-td-pilltag--acc",
  APPROVED: "nx-td-pilltag nx-td-pilltag--ok",
  REJECTED: "nx-td-pilltag nx-td-pilltag--bad",
  WITHDRAWN: "nx-td-pilltag",
};

/** The icon a provider names for its kind: the time-and-decisions set first, the design set otherwise. */
export function KindIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  const td: Record<string, TdIconName> = { key: "key", clock: "clock", pen: "form", check: "stamp" };
  if (icon in td) return <TdIcon name={td[icon]!} size={size} />;
  return <NxIcon name={(icon as NxIconName) || "check"} size={size} />;
}

/** Where a request stands: its outcome once decided, otherwise how long until it is due. */
export function Standing({ item }: { item: Approval }) {
  if (item.status !== "PENDING") {
    return <span className={STATUS_TONE[item.status]}>{item.status.toLowerCase()}</span>;
  }
  if (item.standing === "overdue") {
    return <span className="nx-td-pilltag nx-td-pilltag--bad">Overdue {age(Math.abs(item.due_in_hours ?? 0))}</span>;
  }
  if (item.standing === "due_soon") {
    return <span className="nx-td-pilltag nx-td-pilltag--warn">Due in {age(item.due_in_hours ?? 0)}</span>;
  }
  return <span className="nx-td-pilltag nx-td-pilltag--ok">Due in {age(item.due_in_hours ?? 0)}</span>;
}

export const SCOPES: { key: ApprovalScope | "rules"; label: string }[] = [
  { key: "inbox", label: "Needs a decision" },
  { key: "mine", label: "My requests" },
  { key: "history", label: "Decided" },
  { key: "rules", label: "Rules" },
];
