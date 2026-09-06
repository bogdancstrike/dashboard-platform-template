/** Consistent record/relationship failures retain a useful retry and trace ID. */
import { Alert, Button, Typography } from "antd";
import { ApiError } from "@/api/client";

export function RecordReadError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const apiError = error instanceof ApiError ? error : null;
  return <Alert
    type={apiError?.isNotFound ? "warning" : "error"}
    showIcon
    message={apiError?.isNotFound ? "Record not found" : "Could not load this record"}
    description={<>
      <p>{error.message}</p>
      {apiError && <>
        {apiError.missingPermissions.length > 0 && <p>Missing: {apiError.missingPermissions.join(", ")}</p>}
        <Typography.Text code>Correlation ID: {apiError.correlationId}</Typography.Text>
      </>}
    </>}
    action={<Button onClick={onRetry}>Retry</Button>}
  />;
}
