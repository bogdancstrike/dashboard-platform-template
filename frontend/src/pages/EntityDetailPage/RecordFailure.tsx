import { Button } from "antd";

import { useSmartBack } from "@/app/history";
import { FailureAlert, failureKind, retryHelps } from "@/components/FailureAlert";
import { PageHeader } from "@/components/PageHeader";

/** A record that would not open: what went wrong, a retry when one could help, and the way back. */
export function RecordFailure({
  error,
  listPath,
  onRetry,
}: {
  error: unknown;
  listPath: string;
  onRetry: () => void;
}) {
  const back = useSmartBack();
  const kind = failureKind(error);
  return (
    <>
      <PageHeader
        title={
          kind === "not_found"
            ? "Record not found"
            : kind === "forbidden"
              ? "You may not open this record"
              : "Could not open this record"
        }
        onBack={() => back(listPath)}
      />
      <FailureAlert
        error={error}
        titles={{
          not_found: "Nothing at this address",
          forbidden: "Your role does not include this record",
          failed: "Could not open this record",
        }}
        onRetry={onRetry}
        action={
          retryHelps(kind) ? undefined : (
            <Button onClick={() => back(listPath)}>
              Go back
            </Button>
          )
        }
      />
    </>
  );
}
