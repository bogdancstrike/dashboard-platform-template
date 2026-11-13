import { Button, Popconfirm } from "antd";

import type { ImportRun } from "@/api/imports";

/**
 * Discard an import, or remove its record once the file is gone.
 *
 * Two presses, and the copy changes between them: telling somebody "the record
 * is kept" and then removing it on the next press would be the page
 * contradicting itself.
 */
export function DiscardRun({ run, testId, onConfirm }: { run: ImportRun; testId: string; onConfirm: () => void }) {
  return (
    <Popconfirm
      title={run.holds_file ? "Discard this import?" : "Remove this record?"}
      description={
        run.holds_file
          ? "The file is dropped. The record of having tried is kept."
          : "The import leaves your list. What you tried and when stays in the audit trail."
      }
      okText={run.holds_file ? "Discard it" : "Remove it"}
      cancelText="Keep it"
      onConfirm={onConfirm}
    >
      <Button type="text" data-testid={testId}>
        {run.holds_file ? "Discard" : "Remove"}
      </Button>
    </Popconfirm>
  );
}
