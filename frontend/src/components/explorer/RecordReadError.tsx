import { FailureAlert } from "@/components/FailureAlert";

/**
 * A record or its relationships, when the read failed (§34).
 *
 * The words are the preview's own — a reader who clicked a row in a list
 * wants to know whether the row is gone or their role is short — and the
 * furniture underneath (tone, the missing permission, the copyable trace id,
 * a retry only where one could work) is `FailureAlert`'s.
 */
export function RecordReadError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <FailureAlert
      error={error}
      titles={{
        not_found: "Record not found",
        forbidden: "Your role does not include this record",
        failed: "Could not load this record",
      }}
      onRetry={onRetry}
    />
  );
}
