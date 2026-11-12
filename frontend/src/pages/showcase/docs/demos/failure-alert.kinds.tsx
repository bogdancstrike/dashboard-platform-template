import { ApiError } from "@/api/client";
import { FailureAlert } from "@/components/FailureAlert";

const FAILURES = [
  { status: 500, title: "Those records could not be loaded" },
  { status: 403, title: "Your role does not include this dataset" },
  { status: 404, title: "That record is no longer there" },
  { status: 409, title: "Somebody else changed this first" },
];

export default function FailureAlertKinds() {
  return (
    <div className="nx-doc-col">
      {FAILURES.map(({ status, title }) => (
        <FailureAlert
          key={status}
          error={
            new ApiError(
              status,
              {
                error: "demo",
                message: "The server's own sentence about what happened.",
                details: status === 403 ? { missing: ["records.update"] } : {},
              },
              "b7f2c1a9-demo",
            )
          }
          titles={{ not_found: title, forbidden: title, conflict: title, failed: title }}
          onRetry={() => undefined}
        />
      ))}
    </div>
  );
}
