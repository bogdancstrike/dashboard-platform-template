import { StatusTag } from "@/components/StatusTag";

const VALUES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", "BLOCKED", "FAILED", "SUCCEEDED", "CANCELLED", "DRAFT", "ACTIVE", "INVITED", "SUSPENDED", "AT_RISK", "SLA"];

export default function StatusTagVocabulary() {
  return (
    <div className="nx-doc-row">
      {VALUES.map((value) => (
        <StatusTag key={value} status={value} />
      ))}
    </div>
  );
}
