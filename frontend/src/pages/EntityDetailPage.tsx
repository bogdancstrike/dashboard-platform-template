import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { explorerApi } from "@/api/explorer";
import { recordsApi, type RecordField } from "@/api/records";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { CommentThread } from "@/components/comments/CommentThread";
import { RecordRelations } from "@/components/explorer/RecordRelations";
import { FailureAlert, failureKind, retryHelps } from "@/components/FailureAlert";
import { PageHeader } from "@/components/PageHeader";
import { TagPicker } from "@/components/records/TagPicker";
import { useRecordEditing } from "@/components/records/useRecordEditing";
import { StatusTag } from "@/components/StatusTag";
import { usePageCommands } from "@/commands/CommandContext";
import { absoluteTime, relativeTime } from "@/lib/time";
import { asText } from "@/lib/text";

const { Text } = Typography;

/**
 * Every entity detail page, from one component (§8).
 *
 * Like the list, it renders what the entity's declaration publishes rather
 * than a hand-written layout per type: the server sends each field with its
 * label, kind and value, and this decides only how a kind is drawn. Adding a
 * column to a resource makes it appear here with no frontend change — which is
 * the whole promise of the declarative model, and is worth more than a
 * bespoke layout for each of eleven entities.
 *
 * The History tab is the audit timeline (§21, §48), reading the scoped
 * endpoint — so a reader who may open this record can read what happened to it
 * without being granted the whole ledger.
 *
 * **The conversation and the connections are tabs here, and the page on the
 * task and ticket pages** (§36, §50). That is not an inconsistency: on a work
 * item or a support case, answering *is* the job and the thread belongs above
 * the fold; on an account, an order or a device a comment is occasional, and a
 * thread over the fields would push what the reader came for below them. Both
 * are the same components reading the same endpoints — what differs is where
 * the page puts them, which is the one decision a page is for.
 *
 * Editing (§9) is the same story: the drawer is built from the fields the
 * server marks writable, so the form a reader gets is the form the API will
 * accept. Both controls are *shown and disabled* when the role does not carry
 * the permission, with the permission named — a hidden button teaches nobody
 * that the feature exists (§76).
 */
export default function EntityDetailPage({ resourceKey }: { resourceKey: string }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";

  const record = useQuery({
    queryKey: ["record", resourceKey, id],
    queryFn: ({ signal }) => recordsApi.get(resourceKey, id, signal),
    enabled: Boolean(id),
  });

  // The form needs the *vocabulary* an enum allows, which only the catalogue
  // publishes: read off the record, a status select would offer nothing but
  // the value the record already has.
  const catalogue = useQuery({
    queryKey: ["explorer-catalogue"],
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: 60_000,
  });
  const resource = catalogue.data?.items.find((item) => item.key === resourceKey);

  // The same lifecycle every list page uses, so "edit" means one thing across
  // the product. It reads this record from the cache this page already filled.
  const records = useRecordEditing(resource, {
    onDeleted: () => navigate(record.data?.path ?? "/"),
  });

  usePageCommands(`record:${resourceKey}`, [
    {
      id: "record.edit",
      label: "Edit this record",
      keywords: "change update form",
      run: () => records.edit(id),
    },
    {
      id: "record.copy-link",
      label: "Copy a link to this record",
      keywords: "share url",
      run: () => void navigator.clipboard?.writeText(window.location.href),
    },
    {
      id: "record.history",
      label: "Show this record's history",
      keywords: "audit timeline changes",
      run: () => setParams((current) => {
        const next = new URLSearchParams(current);
        next.set("tab", "history");
        return next;
      }),
    },
  ]);

  if (record.isLoading) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  if (record.isError) {
    const kind = failureKind(record.error);
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
          onBack={() => navigate(-1)}
        />
        <FailureAlert
          error={record.error}
          titles={{
            not_found: "Nothing at this address",
            forbidden: "Your role does not include this record",
            failed: "Could not open this record",
          }}
          onRetry={() => void record.refetch()}
          action={
            retryHelps(kind) ? undefined : (
              <Button onClick={() => navigate(-1)}>
                Go back
              </Button>
            )
          }
        />
      </>
    );
  }

  const data = record.data!;

  return (
    <>
      <PageHeader
        title={data.title}
        onBack={() => navigate(data.path)}
        subtitle={
          <Space size={8} wrap>
            {data.subtitle && <Text type="secondary">{data.subtitle}</Text>}
            <Text type="secondary">
              Updated{" "}
              <Tooltip title={absoluteTime(data.updated_at)}>
                <span>{relativeTime(data.updated_at)}</span>
              </Tooltip>
            </Text>
          </Space>
        }
        tag={<StatusTag status={data.status} data-testid="record-status" />}
        actions={
          <>
            <Tooltip title={data.can_edit ? "" : "Your role does not include records.update"}>
              <Button
                type="primary"
                icon={<EditOutlined />}
                disabled={!data.can_edit}
                onClick={() => records.edit(id)}
                data-testid="record-edit"
              >
                Edit
              </Button>
            </Tooltip>
            <Tooltip title={data.can_delete ? "" : "Your role does not include records.delete"}>
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={!data.can_delete}
                onClick={() => records.remove(id, data.title)}
              >
                Delete
              </Button>
            </Tooltip>
          </>
        }
      />

      {/* Under the header rather than in a tab: a record's tags are read at a
          glance beside its title, and a tab is where things go that a reader
          opens deliberately (§37). */}
      <TagPicker
        resourceType={data.resource_type}
        recordId={data.id}
        listPath={data.path}
      />

      <Tabs
        activeKey={tab}
        onChange={(key) =>
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              if (key === "overview") next.delete("tab");
              else next.set("tab", key);
              return next;
            },
            { replace: true },
          )
        }
        items={[
          {
            key: "overview",
            label: "Overview",
            children: <Overview fields={data.fields} titleField={data.title_field} />,
          },
          {
            // A conversation, and the records this one is connected to, as
            // *tabs* rather than on the page — the opposite of the task and
            // ticket pages, where answering is the job and the thread is the
            // page. On an account or an order a comment is occasional, and a
            // thread above the fold would push the fields a reader came for
            // below it (§36, §33).
            key: "comments",
            label: "Conversation",
            children: (
              <Card size="small">
                <CommentThread resourceType={data.resource_type} resourceId={data.id} />
              </Card>
            ),
          },
          {
            // What this record is joined to, derived from the foreign keys the
            // schema already declares rather than from a per-entity list of
            // "related things" (§50).
            key: "relations",
            label: "Connections",
            children: (
              <Card size="small">
                <RecordRelations resourceType={data.resource_type} recordId={data.id} />
              </Card>
            ),
          },
          {
            key: "history",
            label: "History",
            children: (
              <Card size="small">
                <AuditTimeline resourceType={data.resource_type} resourceId={data.id} />
              </Card>
            ),
          },
        ]}
      />

      {records.drawer}
    </>
  );
}

/**
 * Every declared field, in two columns, with the identifiers last.
 *
 * Ordered by what a reader looks for rather than by the order the declaration
 * happens to be written in: the record's own attributes first, then the ids
 * that connect it to other records, then the timestamps. A detail page that
 * opens with a UUID is a detail page whose first line nobody reads.
 */
function Overview({ fields, titleField }: { fields: RecordField[]; titleField: string }) {
  const isIdentifier = (field: RecordField) =>
    field.kind === "uuid" || field.name.endsWith("_id");
  const isStamp = (field: RecordField) =>
    field.name === "created_at" || field.name === "updated_at";

  const primary = fields.filter(
    (field) => !isIdentifier(field) && !isStamp(field) && field.name !== titleField,
  );
  const identifiers = fields.filter(isIdentifier);
  const stamps = fields.filter(isStamp);

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={16}>
        <Card size="small" title="Details">
          <Descriptions size="small" column={{ xs: 1, md: 2 }} bordered>
            {primary.map((field) => (
              <Descriptions.Item key={field.name} label={field.label}>
                <FieldValue field={field} />
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      </Col>
      <Col xs={24} xl={8}>
        <Card size="small" title="References">
          <Descriptions size="small" column={1} bordered>
            {[...identifiers, ...stamps].map((field) => (
              <Descriptions.Item key={field.name} label={field.label}>
                <FieldValue field={field} />
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      </Col>
    </Row>
  );
}

/** How one value is drawn, decided by the kind the server declared. */
function FieldValue({ field }: { field: RecordField }) {
  const { kind, value } = field;

  if (value === null || value === undefined || value === "") {
    // An explicit em dash, so an empty field is visibly empty rather than
    // looking like a rendering failure.
    return <Text type="secondary">—</Text>;
  }

  if (kind === "bool") {
    return <Tag color={value ? "green" : undefined}>{value ? "Yes" : "No"}</Tag>;
  }

  // `asText` rather than `String` throughout: a `json` or `array` field is an
  // object, and `String({})` is `[object Object]` — which reads as a bug in
  // the field rather than in the rendering of it.
  const text = asText(value);

  if (kind === "datetime") {
    return (
      <Tooltip title={absoluteTime(text)}>
        <Text>{relativeTime(text)}</Text>
      </Tooltip>
    );
  }

  if (kind === "enum") {
    return <StatusTag status={text} />;
  }

  if (kind === "number") {
    return <Text>{Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>;
  }

  if (kind === "uuid") {
    return (
      <Text type="secondary" copyable={{ text }} className="nu-record-id">
        {text}
      </Text>
    );
  }

  return <Text>{text}</Text>;
}
