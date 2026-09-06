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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App as AntApp,
  Alert,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import { explorerApi, type ExplorerField, type ExplorerResource } from "@/api/explorer";
import { recordsApi, type RecordChanges, type RecordDetail, type RecordField } from "@/api/records";
import { PeoplePicker } from "@/components/PeoplePicker";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { asText } from "@/lib/text";

const { Text } = Typography;

/** The declaration one control is built from, whichever endpoint published it. */
export interface EditableField {
  name: string;
  label: string;
  kind: RecordField["kind"];
  choices: string[];
  required: boolean;
  minimum: number | null;
  maximum: number | null;
  references: string;
  /** Rendered as a paragraph box rather than one line. */
  prose: boolean;
}

/**
 * The writable fields of a record, merged with the vocabulary the catalogue
 * publishes.
 *
 * Both halves are needed and neither is enough: the record says which fields
 * may be written and what they currently hold, and the catalogue says which
 * values an enum allows. Reading choices off the record would mean an edit
 * form whose status select is empty for a status nobody has used yet.
 */
export function editableFields(
  resource: ExplorerResource | undefined,
  fields: RecordField[],
  contentFields: string[] = [],
): EditableField[] {
  const declared = new Map<string, ExplorerField>(
    (resource?.fields ?? []).map((field) => [field.name, field]),
  );
  return fields
    .filter((field) => field.editable)
    .map((field) => ({
      name: field.name,
      label: field.label,
      kind: field.kind,
      choices: declared.get(field.name)?.choices ?? [],
      required: Boolean(field.required),
      minimum: field.minimum ?? null,
      maximum: field.maximum ?? null,
      references: field.references ?? declared.get(field.name)?.references ?? "",
      prose: contentFields.includes(field.name),
    }));
}

/** The same list, for a record that does not exist yet (§9 — create). */
export function creatableFields(resource: ExplorerResource | undefined): EditableField[] {
  return (resource?.fields ?? [])
    .filter((field) => field.editable)
    .map((field) => ({
      name: field.name,
      label: field.label,
      kind: field.kind,
      choices: field.choices,
      required: Boolean(field.required),
      minimum: field.minimum ?? null,
      maximum: field.maximum ?? null,
      references: field.references ?? "",
      prose: false,
    }));
}

export interface RecordFormProps {
  open: boolean;
  onClose: () => void;
  resource: ExplorerResource | undefined;
  /** Absent means create; present means edit that record. */
  record?: RecordDetail;
  onSaved?: (saved: RecordDetail) => void;
}

export function RecordForm({ open, onClose, resource, record, onSaved }: RecordFormProps) {
  const [form] = Form.useForm();
  const { message, modal } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [dirty, setDirty] = useState(false);

  const creating = !record;
  const fields = useMemo(
    () =>
      creating
        ? creatableFields(resource)
        : editableFields(resource, record.fields, record.content_fields),
    [creating, resource, record],
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
      message.success(creating ? `${saved.title} created` : `${saved.title} saved`);
      setDirty(false);
      // Every list, lane and aggregate that could contain it is now stale. The
      // server stays the authority: nothing is patched into a cache by hand.
      void queryClient.invalidateQueries({ queryKey: ["record", saved.resource_type] });
      void queryClient.invalidateQueries({ queryKey: ["entity-rows"] });
      void queryClient.invalidateQueries({ queryKey: ["entity-insights"] });
      void queryClient.invalidateQueries({ queryKey: ["task-lane"] });
      onSaved?.(saved);
      onClose();
    },
  });

  const close = () => {
    if (!dirty) {
      onClose();
      return;
    }
    // §74: leaving with unsaved changes is a decision, not an accident.
    modal.confirm({
      title: "Discard your changes?",
      content: "This record has edits that have not been saved.",
      okText: "Discard",
      okButtonProps: { danger: true },
      cancelText: "Keep editing",
      onOk: () => {
        setDirty(false);
        onClose();
      },
    });
  };

  const error = save.error;

  return (
    <Drawer
      open={open}
      onClose={close}
      width={520}
      destroyOnClose
      title={creating ? `New ${singular(resource?.label)}` : `Edit ${record.title}`}
      extra={
        <Space>
          <Button onClick={close}>Cancel</Button>
          <Button
            type="primary"
            loading={save.isPending}
            onClick={() => void form.submit()}
            data-testid="record-form-save"
          >
            {creating ? "Create" : "Save"}
          </Button>
        </Space>
      }
    >
      {error instanceof ApiError && (
        <Alert
          className="nu-block"
          type={error.status === 409 ? "warning" : "error"}
          showIcon
          message={error.message}
          description={
            <Space direction="vertical" size={2}>
              {error.missingPermissions.length > 0 && (
                <Text type="secondary">Missing: {error.missingPermissions.join(", ")}</Text>
              )}
              <Text code copyable={{ text: error.correlationId }}>
                {error.correlationId}
              </Text>
            </Space>
          }
        />
      )}

      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        onValuesChange={() => setDirty(true)}
        onFinish={(values: Record<string, unknown>) => save.mutate(values)}
        disabled={save.isPending}
      >
        {fields.map((field) => (
          <Form.Item
            key={field.name}
            name={field.name}
            label={field.label}
            rules={field.required ? [{ required: true, message: `${field.label} is required` }] : []}
          >
            <FieldControl field={field} />
          </Form.Item>
        ))}
      </Form>
    </Drawer>
  );
}

/**
 * Which values actually travel.
 *
 * Only the fields this reader touched: a payload carrying every rendered field
 * would overwrite the ones somebody else moved while the drawer was open.
 */
function onlyChanged(
  values: Record<string, unknown>,
  initial: Record<string, unknown>,
  fields: EditableField[],
): RecordChanges {
  const changes: RecordChanges = {};
  for (const field of fields) {
    const next = wireValue(values[field.name]);
    const before = wireValue(initial[field.name]);
    // Compared as JSON, not by identity: a `json` field holds an array, and
    // two arrays are never `===` — so an untouched checklist would travel on
    // every save and overwrite whatever somebody else had ticked meanwhile.
    if (JSON.stringify(next) !== JSON.stringify(before)) changes[field.name] = next;
  }
  return changes;
}

/** A control's value as the API reads it: ISO for dates, null for empty. */
function wireValue(value: unknown): unknown {
  if (value === undefined || value === "" || value === null) return null;
  if (dayjs.isDayjs(value)) return value.toISOString();
  return value;
}

/** How one declared field is drawn. Nothing here knows what a ticket is. */
function FieldControl({
  field,
  value,
  onChange,
}: {
  field: EditableField;
  // Supplied by `Form.Item`, which clones this element with them.
  value?: unknown;
  onChange?: (value: unknown) => void;
}) {
  if (field.references === "user") {
    return (
      <PeoplePicker
        multiple={false}
        aria-label={field.label}
        placeholder={`Search people for ${field.label.toLowerCase()}`}
        value={value ? [asText(value)] : []}
        onChange={(ids) => onChange?.(ids[0] ?? null)}
      />
    );
  }

  if (field.references) {
    return (
      <RecordPicker
        resourceType={field.references}
        label={field.label}
        value={value ? asText(value) : undefined}
        onChange={(next) => onChange?.(next ?? null)}
      />
    );
  }

  if (field.kind === "enum") {
    return (
      <Select
        allowClear
        showSearch
        aria-label={field.label}
        placeholder={`Choose a ${field.label.toLowerCase()}`}
        value={value as string | undefined}
        // Typed as always present, but `allowClear` does hand back undefined —
        // and a cleared field has to reach the API as an explicit null.
        onChange={(next: string | undefined) => onChange?.(next ?? null)}
        options={field.choices.map((choice) => ({ value: choice, label: choice.replace(/_/g, " ") }))}
      />
    );
  }

  if (field.kind === "bool") {
    return <Switch checked={Boolean(value)} onChange={(next) => onChange?.(next)} />;
  }

  if (field.kind === "number") {
    return (
      <InputNumber
        style={{ width: "100%" }}
        aria-label={field.label}
        min={field.minimum ?? undefined}
        max={field.maximum ?? undefined}
        value={value as number | undefined}
        onChange={(next) => onChange?.(next)}
      />
    );
  }

  if (field.kind === "datetime") {
    return (
      <DatePicker
        style={{ width: "100%" }}
        showTime
        aria-label={field.label}
        value={(value as Dayjs | undefined) ?? null}
        onChange={(next) => onChange?.(next)}
      />
    );
  }

  if (field.kind === "json" || field.kind === "array") {
    return <StructuredValue field={field} value={value} onChange={onChange} />;
  }

  if (field.prose) {
    return (
      <Input.TextArea
        rows={5}
        aria-label={field.label}
        value={value as string | undefined}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  }

  return (
    <Input
      aria-label={field.label}
      value={value as string | undefined}
      onChange={(event) => onChange?.(event.target.value)}
    />
  );
}

/**
 * A structured field, edited as the JSON it is.
 *
 * Deliberately plain. A page that knows what the document *means* — the task
 * board's checklist, say — gives it a real control; this is the fallback for
 * every other declared JSON field, and it earns its place by being honest:
 * the value is shown as it is stored, and unparseable text is refused here
 * rather than sent to the server to be refused there.
 */
function StructuredValue({
  field,
  value,
  onChange,
}: {
  field: EditableField;
  value: unknown;
  onChange?: (value: unknown) => void;
}) {
  const [text, setText] = useState(() => (value == null ? "" : JSON.stringify(value, null, 2)));
  const [invalid, setInvalid] = useState(false);

  return (
    <>
      <Input.TextArea
        rows={5}
        aria-label={field.label}
        status={invalid ? "error" : undefined}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (!next.trim()) {
            setInvalid(false);
            onChange?.(null);
            return;
          }
          try {
            onChange?.(JSON.parse(next));
            setInvalid(false);
          } catch {
            // Left invalid rather than sent: the server would refuse it, and
            // a save that fails on syntax is a round trip nobody needed.
            setInvalid(true);
          }
        }}
      />
      {invalid && (
        <Text type="danger" style={{ fontSize: 12 }}>
          That is not valid JSON yet.
        </Text>
      )}
    </>
  );
}

/**
 * Pick a record from the dataset a foreign key points at.
 *
 * Searched on the server, like the people picker and for the same reason: a
 * control that filters the first fifty rows it downloaded cannot find the
 * project whose name starts with "W".
 */
function RecordPicker({
  resourceType,
  label,
  value,
  onChange,
}: {
  resourceType: string;
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term, 250);

  const results = useQuery({
    queryKey: ["record-picker", resourceType, debounced, value],
    queryFn: ({ signal }) =>
      explorerApi.query(
        {
          resource_type: resourceType,
          query_text: debounced,
          filters: {},
          page: 1,
          page_size: 20,
        },
        signal,
      ),
    staleTime: 30_000,
  });

  const options = (results.data?.items ?? []).map((row) => {
    const item = row as Record<string, unknown>;
    return {
      value: String(item.id),
      label: String(item.name ?? item.title ?? item.subject ?? item.reference ?? item.code ?? item.id),
    };
  });
  // A stored id has to keep rendering while the search term moves on, even if
  // the current page of results no longer contains it.
  if (value && !options.some((option) => option.value === value)) {
    options.unshift({ value, label: value });
  }

  return (
    <Select
      showSearch
      allowClear
      aria-label={label}
      placeholder={`Search ${resourceType}s`}
      loading={results.isFetching}
      value={value}
      searchValue={term}
      onSearch={setTerm}
      filterOption={false}
      notFoundContent={results.isFetching ? "Searching…" : "Nothing by that name"}
      options={options}
      onChange={(next: string | undefined) => onChange(next ?? undefined)}
    />
  );
}

function singular(label: string | undefined): string {
  return (label ?? "record").replace(/s$/, "").toLowerCase();
}
