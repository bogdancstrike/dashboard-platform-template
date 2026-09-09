import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Form, Modal, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { ApiError } from "@/api/client";
import type { BulkAction, BulkFailure, BulkRequest, BulkSelection } from "@/api/bulk";
import { bulkApi } from "@/api/bulk";
import type { ExplorerField, ExplorerResource } from "@/api/explorer";
import { formatNumber } from "@/lib/formats";

const { Text } = Typography;

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

/** The fields a bulk edit offers: a closed vocabulary, and nothing else. */
export function settableFields(resource: ExplorerResource | undefined): ExplorerField[] {
  return (resource?.fields ?? []).filter(
    (field) => field.editable && field.kind === "enum" && field.choices.length > 0,
  );
}

/** What the confirm button says, so it names the act rather than agreeing to it. */
export function confirmLabel(
  action: BulkAction,
  eligible: number,
  resource: ExplorerResource | undefined,
): string {
  const noun = eligible === 1 ? singular(resource) : (resource?.label ?? "records").toLowerCase();
  return `${action === "delete" ? "Delete" : "Update"} ${formatNumber(eligible)} ${noun}`;
}

function singular(resource: ExplorerResource | undefined): string {
  return (resource?.label ?? "record").replace(/s$/, "").toLowerCase();
}

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
    queryKey: ["bulk-preview", resource?.key, request],
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
      title={action === "delete" ? `Delete ${resource?.label ?? "records"}` : `Change ${resource?.label ?? "records"}`}
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
                  data-testid="bulk-field"
                />
              </Form.Item>
              <Form.Item label="New value">
                <Select
                  value={value || undefined}
                  onChange={setValue}
                  options={(fields.find((item) => item.name === field)?.choices ?? []).map(
                    (choice) => ({ value: choice, label: choice }),
                  )}
                  placeholder="Set it to"
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

/** The §75 half: how many, which, and what will be left alone. */
function Consequences({
  found,
  resource,
}: {
  found: NonNullable<Awaited<ReturnType<typeof bulkApi.preview>>>;
  resource: ExplorerResource | undefined;
}) {
  return (
    <div className="nu-bulk-preview" data-testid="bulk-preview">
      <Text strong>{found.describes}</Text>
      {found.by_filter > 0 && found.by_hand > 0 && (
        // The split, spelled out. Somebody who ticked twelve boxes knows what
        // is in them; somebody who filtered does not, and one total hides
        // which of the two they are about to act on.
        <div className="nu-bulk-split">
          <Tag>{formatNumber(found.by_hand)} selected by hand</Tag>
          <Tag>{formatNumber(found.by_filter)} matched by the filter</Tag>
        </div>
      )}

      {found.sample.length > 0 && (
        <div className="nu-bulk-sample">
          <Text type="secondary">Including</Text>
          <ul>
            {found.sample.map((entry) => (
              <li key={entry.id}>{entry.title}</li>
            ))}
          </ul>
        </div>
      )}

      {found.refused.map((refusal) => (
        <Alert
          key={refusal.reason}
          type="warning"
          showIcon
          className="nu-bulk-refusal"
          message={`${formatNumber(refusal.count)} will be left alone — ${refusal.reason.toLowerCase()}`}
        />
      ))}

      {found.over_limit && (
        <Alert
          type="error"
          showIcon
          data-testid="bulk-over-limit"
          message={`That is more than ${formatNumber(found.limit)} ${(resource?.label ?? "records").toLowerCase()}`}
          description="Narrow the filter and try again. One action is capped so that a wrong filter is a mistake somebody notices rather than a restore."
        />
      )}

      {!found.over_limit && found.eligible === 0 && (
        <Alert
          type="info"
          showIcon
          message="Nothing here would change"
          description="Every selected record is already as you are asking for it to be."
        />
      )}
    </div>
  );
}

/** Both halves of what happened, because both are normal. */
function Outcome({
  result,
  resource,
}: {
  result: NonNullable<Awaited<ReturnType<typeof bulkApi.apply>>>;
  resource: ExplorerResource | undefined;
}) {
  const columns: ColumnsType<BulkFailure> = [
    { title: (resource?.label ?? "Record").replace(/s$/, ""), dataIndex: "title" },
    { title: "Why not", dataIndex: "message" },
  ];

  return (
    <div className="nu-bulk-body" data-testid="bulk-result">
      <Alert
        type={result.failed.length > 0 ? "warning" : "success"}
        showIcon
        message={result.message}
      />
      {result.failed.length > 0 && (
        <>
          <Text type="secondary">
            The rest were applied. A refusal on one record does not undo the others.
          </Text>
          <Table<BulkFailure>
            rowKey="id"
            size="small"
            pagination={false}
            columns={columns}
            dataSource={result.failed}
            data-testid="bulk-failures"
          />
        </>
      )}
    </div>
  );
}
