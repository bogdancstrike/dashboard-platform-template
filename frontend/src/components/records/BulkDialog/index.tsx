import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Form, Modal, Select, Space, Typography } from "antd";

import { ApiError } from "@/api/client";
import { humanStatus } from "@/components/StatusTag";
import type { BulkAction, BulkRequest, BulkSelection } from "@/api/bulk";
import { bulkApi } from "@/api/bulk";
import type { ExplorerResource } from "@/api/explorer";
import { queryKeys } from "@/lib/queryKeys";

import { Consequences, Outcome } from "./BulkParts";
import { confirmLabel, settableFields } from "./bulkWords";

const { Text } = Typography;


export { confirmLabel, settableFields } from "./bulkWords";
/**
 * Confirming a change to many records, and reading what happened (§43, §75).
 *
 * The dialog has three states and each earns its place.
 *
 * **Compose.** For an update, which field and which value. Only the fields with
 * a closed vocabulary are offered — a status, a priority, a health — because
 * those are the bulk edits somebody actually wants and because a free-text box
 * applied to two hundred records is the most destructive control a list could
 * have. The API accepts any writable field; what is *offered* here is a
 * narrower, deliberate choice.
 *
 * **Preview.** Never skipped, and this is the heart of §75. "Everything
 * matching this filter" is a sentence whose consequences the reader cannot see:
 * the filter might match nine rows or nine hundred. So the server is asked
 * first, and it answers with the count split into *ticked by hand* and *matched
 * by the filter* — trusted differently, because ticking a box is knowing what
 * is in it — a few of the actual names, and every reason a row would be
 * refused.
 *
 * **Result.** Both halves. Forty-eight applied and two refused is the normal
 * outcome of a bulk gesture, and a dialog that closed on a toast saying
 * "done" would have hidden the two. The refusals are listed per record with
 * the server's own reason, because "2 failed" is not something anybody can act
 * on.
 */

export function BulkDialog({
  open,
  action,
  resource,
  selection,
  onClose,
  onApplied,
}: {
  open: boolean;
  action: BulkAction;
  resource: ExplorerResource | undefined;
  selection: BulkSelection;
  onClose: () => void;
  /** Called once a change landed, so the page can refetch and clear. */
  onApplied: (applied: number) => void;
}) {
  const fields = useMemo(() => settableFields(resource), [resource]);
  const [field, setField] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof bulkApi.apply>> | null>(null);

  // Reset on every opening: a dialog that reopens showing the last result is a
  // dialog somebody confirms twice.
  useEffect(() => {
    if (!open) return;
    setResult(null);
    setField(fields[0]?.name ?? "");
    setValue("");
  }, [open, fields]);

  const changes = action === "update" && field && value ? { [field]: value } : undefined;
  const request: BulkRequest = { action, selection, ...(changes ? { changes } : {}) };
  const ready = action === "delete" || Boolean(changes);

  const preview = useQuery({
    queryKey: queryKeys.bulkPreview(resource?.key, request),
    queryFn: ({ signal }) => bulkApi.preview(resource!.key, request, signal),
    // Only once the gesture is fully described. Previewing an update with no
    // value chosen would ask the server a question with no answer.
    enabled: open && Boolean(resource) && ready && result === null,
  });

  const apply = useMutation({
    mutationFn: () => bulkApi.apply(resource!.key, request),
    onSuccess: (answer) => {
      setResult(answer);
      onApplied(answer.applied);
    },
  });

  const found = preview.data;
  const blocked = !found || found.over_limit || found.eligible === 0;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <span className="nx-rec-formtitle">
          <span>
            {action === "delete"
              ? `Delete ${resource?.label.toLowerCase() ?? "records"}`
              : `Change ${resource?.label.toLowerCase() ?? "records"}`}
          </span>
          <small>{resource?.label ?? "Records"} · applies to the selected rows only</small>
        </span>
      }
      className="nx-rec-formmodal nx-rec-bulkmodal"
      centered
      destroyOnHidden
      width={620}
      footer={
        result ? (
          <Button type="primary" onClick={onClose} data-testid="bulk-done">
            Close
          </Button>
        ) : (
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              type="primary"
              danger={action === "delete"}
              loading={apply.isPending}
              disabled={blocked}
              onClick={() => apply.mutate()}
              data-testid="bulk-confirm"
            >
              {confirmLabel(action, found?.eligible ?? 0, resource)}
            </Button>
          </Space>
        )
      }
      data-testid="bulk-dialog"
    >
      {result ? (
        <Outcome result={result} resource={resource} />
      ) : (
        <div className="nu-bulk-body">
          {action === "update" && (
            <Form layout="vertical" size="small" className="nu-bulk-form">
              <Form.Item label="Field">
                <Select
                  value={field || undefined}
                  onChange={(next) => {
                    setField(next);
                    setValue("");
                  }}
                  options={fields.map((item) => ({ value: item.name, label: item.label }))}
                  placeholder="Which field"
                  // A Form.Item with no name does not tie its label to the
                  // control, so the select carries its own (axe label).
                  aria-label="Field"
                  data-testid="bulk-field"
                />
              </Form.Item>
              <Form.Item label="New value">
                <Select
                  value={value || undefined}
                  onChange={setValue}
                  options={(fields.find((item) => item.name === field)?.choices ?? []).map(
                    (choice) => ({ value: choice, label: humanStatus(choice) }),
                  )}
                  placeholder="Set it to"
                  aria-label="New value"
                  disabled={!field}
                  data-testid="bulk-value"
                />
              </Form.Item>
            </Form>
          )}

          {!ready && (
            <Text type="secondary">
              Choose a field and a value, and this will say exactly what it would change.
            </Text>
          )}

          {preview.error instanceof ApiError && (
            <Alert type="error" showIcon message={preview.error.message} />
          )}

          {found && <Consequences found={found} resource={resource} />}
        </div>
      )}
    </Modal>
  );
}
