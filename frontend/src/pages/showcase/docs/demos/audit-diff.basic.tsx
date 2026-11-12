import type { AuditChange } from "@/api/audit";
import { AuditDiff } from "@/components/audit/AuditDiff";

const CHANGES: AuditChange[] = [
  { field: "status", from: "IN_PROGRESS", to: "BLOCKED", kind: "changed" },
  { field: "assignee", from: null, to: "Mara Manager", kind: "added" },
  { field: "due_date", from: "2026-09-04", to: null, kind: "cleared" },
];

export default function AuditDiffBasic() {
  return <AuditDiff changes={CHANGES} />;
}
