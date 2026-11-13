import { Alert, Button, Card, Tag } from "antd";
import { ClearOutlined } from "@ant-design/icons";

import { auditApi, type AuditRow } from "@/api/audit";
import { ApiError } from "@/api/client";
import { EmptyState, NoResults } from "@/components/EmptyState";
import { ExportButton } from "@/components/ExportButton";
import { apiErrorDetails } from "@/components/feedback/apiErrorDetails";
import { ResponsiveTable } from "@/components/listing/ResponsiveTable";
import { PageHeader } from "@/components/PageHeader";

import { AuditFilters } from "./AuditFilters";
import { EntryDrawer } from "./EntryDrawer";
import { auditCard, auditColumns } from "./auditColumns";
import { useAuditPage } from "./useAuditPage";

/**
 * The audit explorer (§21).
 *
 * Comprehensive by design: **who** (actor, role, and the impersonator when
 * there was one), **when**, **what** (action, resource type, id, label) and the
 * field-level **before → after** diff behind every row.
 *
 * Filtering, faceting, sorting and paging all happen in PostgreSQL (§71). An
 * audit screen that filters a downloaded page is the worst possible place for
 * that mistake: it answers "nobody deleted anything" from twenty-five of four
 * thousand rows, with no way for the reader to tell.
 *
 * The whole question lives in the URL (§69, §72), so an investigation can be
 * pasted into a ticket and reopened exactly as it was.
 */
export default function AuditExplorerPage() {
  const audit = useAuditPage();
  const { query, ledger, filterCount, clearFilters } = audit;

  return (
    <div className="nx-ad nx-ad--audit">
      <PageHeader
        title={<>Audit <em>log</em></>}
        subtitle="Every recorded action: who did it, when, to what, and exactly what changed."
        tag={
          ledger.data ? (
            <Tag color="blue" data-testid="audit-total">
              {ledger.data.total.toLocaleString()} entries
            </Tag>
          ) : undefined
        }
        actions={
          <>
            {filterCount > 0 && (
              <Button icon={<ClearOutlined />} onClick={clearFilters}>
                Clear {filterCount} filter{filterCount === 1 ? "" : "s"}
              </Button>
            )}
            {/* The file carries the filters on screen, not the page: an audit
                export of twenty-five of four thousand rows would be evidence
                of nothing. */}
            <ExportButton
              onExport={(format) => auditApi.export({ ...query, page: undefined, format })}
            />
          </>
        }
      />

      <AuditFilters page={audit} />

      {ledger.isError && (
        <Alert
          className="nu-block"
          type={ledger.error instanceof ApiError && ledger.error.isForbidden ? "warning" : "error"}
          showIcon
          message={
            ledger.error instanceof ApiError && ledger.error.isForbidden
              ? "You do not have permission to read the audit log"
              : ledger.error instanceof ApiError
                ? ledger.error.message
                : "Could not load the audit log"
          }
          description={apiErrorDetails(ledger.error)}
          action={
            <Button onClick={() => void ledger.refetch()}>
              Retry
            </Button>
          }
        />
      )}

      <AuditTable page={audit} />

      <EntryDrawer page={audit} />
    </div>
  );
}

/** The ledger; a row opens its entry. */
function AuditTable({ page }: { page: ReturnType<typeof useAuditPage> }) {
  const { page: current, pageSize, order, set, ledger, filterCount, clearFilters, onTableChange } = page;
  return (
    <Card size="small" className="nu-block">
      <ResponsiveTable<AuditRow>
        card={auditCard}
        rowKey="id"
        size="small"
        columns={auditColumns(order)}
        dataSource={ledger.data?.items ?? []}
        loading={ledger.isLoading}
        onChange={onTableChange}
        scroll={{ x: 900 }}
        onRow={(row) => ({
          onClick: () => set({ entry: row.id }, false),
          style: { cursor: "pointer" },
        })}
        locale={{
          emptyText: ledger.isLoading ? (
            " "
          ) : filterCount > 0 ? (
            <NoResults filterCount={filterCount} onClear={clearFilters} />
          ) : (
            <EmptyState
              title="Nothing has been recorded yet"
              hint="Every write through the API appends an entry here, in the same transaction as the change it describes."
            />
          ),
        }}
        pagination={{
          current: ledger.data?.page ?? current,
          pageSize: ledger.data?.page_size ?? pageSize,
          total: ledger.data?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [25, 50, 100, 200],
          showTotal: (total, range) =>
            `${range[0]}–${range[1]} of ${total.toLocaleString()}`,
        }}
      />
    </Card>
  );
}
