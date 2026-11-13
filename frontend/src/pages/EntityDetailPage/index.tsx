import { useQuery } from "@tanstack/react-query";
import {
  Card,
  Skeleton,
  Space,
  Tabs,
  Tooltip,
  Typography,
} from "antd";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useSmartBack } from "@/app/history";

import { explorerApi } from "@/api/explorer";
import { recordsApi } from "@/api/records";
import { AuditTimeline } from "@/components/audit/AuditTimeline";
import { CustomerHealthPanel } from "@/components/recordsAnalytics/CustomerHealthPanel";
import { VersionHistory } from "@/components/recordsAnalytics/VersionHistory";
import { CommentThread } from "@/components/comments/CommentThread";
import { RecordRelations } from "@/components/explorer/RecordRelations";
import { PageHeader } from "@/components/PageHeader";
import { TagPicker } from "@/components/records/TagPicker";
import { useRecordEditing } from "@/components/records/useRecordEditing";
import { StatusTag } from "@/components/StatusTag";
import { usePageCommands } from "@/commands/CommandContext";
import { RecordDeleteButton, RecordEditButton } from "@/entities/detail";
import { absoluteTime, relativeTime } from "@/lib/time";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { Overview } from "./Overview";
import { RecordFailure } from "./RecordFailure";

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
  const back = useSmartBack();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";

  const record = useQuery({
    queryKey: queryKeys.record(resourceKey, id),
    queryFn: ({ signal }) => recordsApi.get(resourceKey, id, signal),
    enabled: Boolean(id),
  });

  // The form needs the *vocabulary* an enum allows, which only the catalogue
  // publishes: read off the record, a status select would offer nothing but
  // the value the record already has.
  const catalogue = useQuery({
    queryKey: queryKeys.explorerCatalogue(),
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: STALE.minute,
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
    return (
      <RecordFailure error={record.error} listPath={`/${resourceKey}s`} onRetry={() => void record.refetch()} />
    );
  }

  const data = record.data!;

  return (
    <>
      <PageHeader
        title={data.title}
        onBack={() => back(data.path)}
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
            <RecordEditButton allowed={data.can_edit} onEdit={() => records.edit(id)} />
            <RecordDeleteButton allowed={data.can_delete} onDelete={() => records.remove(id, data.title)} />
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
        className="nx-rec-tabs"
        activeKey={tab}
        onChange={(key) =>
          setParams(
            (current) => {
              const next = new URLSearchParams(current);
              if (key === "overview") next.delete("tab");
              else next.set("tab", key);
              return next;
            },
            { replace: false },
          )
        }
        items={[
          {
            key: "overview",
            label: "Overview",
            children: <Overview fields={data.fields} titleField={data.title_field} />,
          },
          // Customer health (§12): the score and why, on the account itself.
          ...(resourceKey === "customer"
            ? [{ key: "health", label: "Health", children: <CustomerHealthPanel customerId={data.id} /> }]
            : []),
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
                {/* Versions with compare and restore (§17), above the raw trail. */}
                <VersionHistory resourceType={data.resource_type} recordId={data.id} onRestored={() => void record.refetch()} />
                <h3 className="nu-section-title" style={{ marginTop: 18 }}>Audit trail</h3>
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
