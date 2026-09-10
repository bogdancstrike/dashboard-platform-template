/**
 * Creating, editing and deleting a record, from any page (§9, §43, §73).
 *
 * The six entity pages share no layout on purpose — a board, a timeline, a
 * ledger and a fleet monitor are four different jobs. What they do share is
 * the *contract*: one declaration decides which fields may be written, the
 * same endpoint writes them, and the same three questions have to be answered
 * identically everywhere — may this reader create one, what happens when they
 * edit, and what does a delete confirm.
 *
 * So the lifecycle lives here, once, and each page decides only where to put
 * the control. A page that wrote its own drawer would be a second definition
 * of what a task is editable in, wrong the first time a column moves.
 *
 * The record is fetched when the drawer opens rather than taken from the row:
 * a list carries the columns it draws, and a form built from those would offer
 * whichever fields the page happened to select. The detail is the one place
 * that knows every writable field and the version being edited.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Dropdown, Tooltip } from "antd";
import { DeleteOutlined, EditOutlined, MoreOutlined, PlusOutlined } from "@ant-design/icons";
import { useState, type ReactNode } from "react";

import { ApiError } from "@/api/client";
import type { ExplorerResource } from "@/api/explorer";
import { recordsApi } from "@/api/records";
import { RecordForm } from "@/components/records/RecordForm";
import { refreshRecordViews } from "@/lib/refresh";

export interface RecordEditing {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Open an empty form for a new record. */
  create: () => void;
  /** Open the form on one record, loading it in full first. */
  edit: (id: string) => void;
  /** Confirm, delete, and refresh whatever was showing it. */
  remove: (id: string, label: string) => void;
  /** Rendered once per page — the drawer itself. */
  drawer: ReactNode;
}

export function useRecordEditing(
  resource: ExplorerResource | undefined,
  options: { onCreated?: (id: string) => void; onDeleted?: () => void } = {},
): RecordEditing {
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const record = useQuery({
    queryKey: ["record", resource?.key, editingId],
    queryFn: ({ signal }) => recordsApi.get(resource!.key, editingId!, signal),
    enabled: Boolean(resource && editingId),
  });

  /** Everything that could be showing this record is now stale. */
  const refresh = () => {
    refreshRecordViews(queryClient);
  };

  const remove = (id: string, label: string) => {
    if (!resource) return;
    modal.confirm({
      title: `Delete ${label}?`,
      content:
        "It disappears from every list. The audit trail keeps what it was and who removed it.",
      okText: "Delete",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await recordsApi.remove(resource.key, id);
          message.success(`${label} deleted`);
          refresh();
          options.onDeleted?.();
        } catch (error) {
          message.error(
            error instanceof ApiError ? error.message : "That record could not be deleted.",
          );
        }
      },
    });
  };

  const close = () => {
    setCreating(false);
    setEditingId(null);
  };

  return {
    canCreate: resource?.can_create ?? false,
    canEdit: resource?.can_edit ?? false,
    canDelete: resource?.can_delete ?? false,
    create: () => setCreating(true),
    edit: (id) => setEditingId(id),
    remove,
    drawer: (
      <RecordForm
        // Remounted per record, so the drawer never opens showing the values
        // of the one before it while the next is still loading.
        key={editingId ?? "new"}
        // On the click, not on the response. The read is fast on a warm
        // database and not fast on a cold one, and a reader who presses Edit
        // and sees nothing at all concludes the button is broken (§34).
        open={creating || Boolean(editingId)}
        onClose={close}
        resource={resource}
        record={creating ? undefined : record.data}
        loading={record.isLoading}
        readError={record.error ?? undefined}
        onRetryRead={() => void record.refetch()}
        onSaved={(saved) => {
          refresh();
          if (creating) options.onCreated?.(saved.id);
        }}
      />
    ),
  };
}

/** "New customer" — the same control, wherever a list puts it. */
export function NewRecordButton({
  records,
  resource,
}: {
  records: RecordEditing;
  resource: ExplorerResource | undefined;
}) {
  return (
    <Tooltip title={records.canCreate ? "" : "Your role does not include records.create"}>
      <Button
        type="primary"
        icon={<PlusOutlined />}
        disabled={!records.canCreate}
        onClick={records.create}
        data-testid="record-create"
      >
        New {singular(resource?.label)}
      </Button>
    </Tooltip>
  );
}

/**
 * Edit and delete for one row.
 *
 * A menu rather than two buttons: these sit inside dense rows and cards, and
 * two icons per row on a forty-row ledger is a column of noise. Disabled with
 * the reason rather than absent, like every other refusal (§76).
 */
export function RecordActions({
  records,
  id,
  label,
  size = "small",
}: {
  records: RecordEditing;
  id: string;
  /** What the confirmation calls it — the reference, not the UUID. */
  label: string;
  size?: "small" | "middle";
}) {
  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        items: [
          {
            key: "edit",
            icon: <EditOutlined />,
            label: records.canEdit ? "Edit" : "Edit — needs records.update",
            disabled: !records.canEdit,
          },
          {
            key: "delete",
            icon: <DeleteOutlined />,
            label: records.canDelete ? "Delete" : "Delete — needs records.delete",
            disabled: !records.canDelete,
            danger: records.canDelete,
          },
        ],
        onClick: ({ key, domEvent }) => {
          // The menu is portalled to the body and a React portal still bubbles
          // through the component tree, so without this the click also opens
          // the row underneath it.
          domEvent.stopPropagation();
          if (key === "edit") records.edit(id);
          else records.remove(id, label);
        },
      }}
    >
      <Button
        type="text"
        size={size}
        icon={<MoreOutlined />}
        aria-label={`Actions for ${label}`}
        onClick={(event) => event.stopPropagation()}
      />
    </Dropdown>
  );
}

function singular(label: string | undefined): string {
  return (label ?? "record").replace(/s$/, "").toLowerCase();
}
