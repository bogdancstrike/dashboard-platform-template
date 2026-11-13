/**
 * The create and edit form every entity shares (§9).
 *
 * One form for six datasets, for the same reason there is one detail page:
 * the server already declares which fields may be written, what kind each is,
 * what values an enum allows, what bounds a number has and which dataset a
 * foreign key points at. A hand-written form per entity would be a second
 * description of all of that, wrong the first time a column moves.
 *
 * What it decides is only how a *kind* is drawn — a vocabulary becomes a
 * select, a bounded number a spinner with those bounds, a foreign key a picker
 * that searches the dataset it points at. Nothing here knows what a ticket is.
 *
 * Three behaviours are deliberate:
 *
 * * **It sends what changed, not the whole record.** A form that PUTs every
 *   field it rendered overwrites the ones somebody else moved while it was
 *   open, even the ones this reader never looked at.
 * * **It sends the version it was editing**, so the server can refuse a write
 *   against a record that has since moved on (§73) rather than silently
 *   discarding the other edit.
 * * **It guards the close** when there are unsaved changes (§74).
 */

import { heldMessage } from "@/components/decisions/held";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Form, Modal, Skeleton, Space } from "antd";
import dayjs from "dayjs";
import { useMemo } from "react";

import { ApiError } from "@/api/client";
import { type ExplorerResource } from "@/api/explorer";
import { recordsApi, type RecordDetail } from "@/api/records";
import { EmptyState } from "@/components/EmptyState";
import { FailureAlert } from "@/components/FailureAlert";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { asText } from "@/lib/text";
import { refreshRecordViews } from "@/lib/refresh";
import { queryKeys } from "@/lib/queryKeys";

import { FieldControl } from "./FieldControl";
import { creatableFields, editableFields, onlyChanged, singular, wide } from "./fields";

export interface RecordFormProps {
  open: boolean;
  onClose: () => void;
  resource: ExplorerResource | undefined;
  /** Absent means create; present means edit that record. */
  record?: RecordDetail;
  onSaved?: (saved: RecordDetail) => void;
  /**
   * The record being edited is still on the wire.
   *
   * The drawer opens on the click rather than on the response: waiting for
   * the read before opening anything means a reader presses Edit and the
   * product appears to have ignored them (§34, §21). So the drawer opens
   * field-shaped and fills in.
   */
  loading?: boolean;
  /** The read failed — say which way, rather than opening a blank form. */
  readError?: unknown;
  /** Try the read again, for the kinds of failure where that could work. */
  onRetryRead?: () => void;
}

export function RecordForm({
  open,
  onClose,
  resource,
  record,
  onSaved,
  loading = false,
  readError,
  onRetryRead,
}: RecordFormProps) {
  const [form] = Form.useForm();
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  // §74, from the one hook every drawer and modal in the platform uses.
  const { touch, settled, requestClose: close } = useDiscardGuard({
    close: onClose,
    what: "record",
  });

  // Open with nothing to show yet: the record is on the wire, or the read
  // already failed. Neither is a create, and calling it one would title the
  // drawer "New task" over somebody's edit.
  const pending = loading || Boolean(readError);
  const creating = !record && !pending;
  const fields = useMemo(
    () =>
      record
        ? editableFields(resource, record.fields, record.content_fields)
        : creatableFields(resource),
    [resource, record],
  );

  const initial = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      const current = record?.fields.find((item) => item.name === field.name)?.value ?? null;
      values[field.name] =
        field.kind === "datetime" && current ? dayjs(asText(current)) : (current ?? undefined);
    }
    return values;
  }, [fields, record]);

  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      const changes = onlyChanged(values, initial, fields);
      if (!record) return recordsApi.create(resource!.key, changes);
      return recordsApi.update(resource!.key, record.id, {
        ...changes,
        expected_updated_at: record.updated_at,
      });
    },
    onSuccess: (saved) => {
      const held = heldMessage(saved);
      if (held) message.info(held);
      else message.success(creating ? `${saved.title} created` : `${saved.title} saved`);
      settled();
      // Every list, lane and aggregate that could contain it is now stale. The
      // server stays the authority: nothing is patched into a cache by hand.
      void queryClient.invalidateQueries({ queryKey: queryKeys.record(saved.resource_type) });
      refreshRecordViews(queryClient);
      onSaved?.(saved);
      onClose();
    },
  });

  const saveError = save.error;
  /** Nothing to write: the catalogue declares no field of this kind writable. */
  const nothingWritable = !pending && fields.length === 0;

  return (
    <Modal
      open={open}
      onCancel={close}
      width={680}
      centered
      destroyOnHidden
      className="nx-rec-formmodal"
      title={
        <span className="nx-rec-formtitle">
          <span>
            {creating
              ? `New ${singular(resource?.label)}`
              : record
                ? `Edit ${record.title}`
                : `Edit ${singular(resource?.label)}`}
          </span>
          <small>
            {resource?.label ?? "Record"} · fields marked <b>*</b> are required
          </small>
        </span>
      }
      footer={
        <Space>
          <Button onClick={close}>Cancel</Button>
          <Button
            type="primary"
            loading={save.isPending}
            // There is nothing to send while the record is still arriving, and
            // nothing to send if the dataset declares nothing writable. A live
            // primary button over a skeleton is a promise of a save that would
            // post an empty form.
            disabled={pending || nothingWritable}
            onClick={() => void form.submit()}
            data-testid="record-form-save"
          >
            {creating ? `Create ${singular(resource?.label)}` : "Save"}
          </Button>
        </Space>
      }
    >
      {readError ? (
        <FailureAlert
          error={readError}
          titles={{
            not_found: "That record is no longer there",
            forbidden: "Your role does not include this record",
            failed: "Could not open this record for editing",
          }}
          onRetry={onRetryRead}
        />
      ) : loading ? (
        // Shaped like the form that is coming — a label and a control, eight
        // times — rather than a spinner in the middle of an empty drawer.
        <Skeleton active title={false} paragraph={{ rows: 8 }} />
      ) : nothingWritable ? (
        <EmptyState
          title="Nothing here can be edited"
          // Which of the two it is matters: a dataset nobody may create into
          // is a permission question for an administrator, and a record whose
          // every field is read-only is a fact about this record.
          hint={
            creating
              ? `The catalogue declares no writable fields for ${
                  resource?.label ?? "this dataset"
                }, so there is no form to show.`
              : "Every field on this record is read-only for your role, so there is no form to show."
          }
        />
      ) : (
        <>
          {saveError instanceof ApiError && (
            <FailureAlert
              className="nu-block"
              error={saveError}
              // The headline names the kind and the server's own sentence
              // sits under it — printing the message as both is one failure
              // said twice.
              titles={{
                conflict: "Somebody else changed this record first",
                forbidden: "Your role does not include writing this record",
                not_found: "That record is no longer there",
                failed: "That change was not saved",
              }}
            />
          )}

          <Form
            form={form}
            className="nx-rec-form"
            layout="vertical"
            initialValues={initial}
            onValuesChange={touch}
            onFinish={(values: Record<string, unknown>) => save.mutate(values)}
            disabled={save.isPending}
          >
            {fields.map((field) => (
              <Form.Item
                key={field.name}
                name={field.name}
                label={field.label}
                className={wide(field) ? "is-wide" : undefined}
                rules={
                  field.required
                    ? [{ required: true, message: `${field.label} is required` }]
                    : []
                }
              >
                <FieldControl field={field} />
              </Form.Item>
            ))}
          </Form>
        </>
      )}
    </Modal>
  );
}
