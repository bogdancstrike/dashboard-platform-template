import { Alert, Button } from "antd";

import { ApiError } from "@/api/client";
import { apiErrorDetails } from "@/components/feedback/apiErrorDetails";

export function NetworkError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const forbidden = error instanceof ApiError && error.isForbidden;
  return (
    <Alert
      type={forbidden ? "warning" : "error"}
      showIcon
      message={
        forbidden
          ? "You do not have permission to read the record graph"
          : "The record graph could not be loaded"
      }
      description={apiErrorDetails(error)}
      action={
        <Button size="small" onClick={onRetry}>
          Retry
        </Button>
      }
    />
  );
}
