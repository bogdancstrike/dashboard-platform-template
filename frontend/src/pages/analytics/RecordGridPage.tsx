/**
 * A record list as a spreadsheet (§18) — `/customers/grid`, `/tasks/grid`, …
 *
 * The columns are the dataset's editable fields of a kind a cell can hold
 * (text, number, status, yes/no, date); references and read-only fields are
 * shown locked. The rows are the list's own query — the same filters arrive
 * in the address — up to the bulk API's five-hundred-row cap.
 */
import "@/styles/analytics.css";

import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Skeleton } from "antd";
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useSmartBack } from "@/app/history";
import { explorerApi, type ExplorerResource } from "@/api/explorer";
import { RecordGrid, type GridRow } from "@/components/analytics/RecordGrid";
import { FailureAlert } from "@/components/FailureAlert";
import { PageHeader } from "@/components/PageHeader";
import type { GridColumn, GridKind } from "@/lib/gridSheet";

const PAGE = 200;
const CAP = 500;
const CELL_KINDS: GridKind[] = ["text", "number", "enum", "bool", "datetime"];
const RESERVED = new Set(["page", "page_size", "sort", "order", "view", "q", "panel"]);

export function gridColumns(resource: ExplorerResource): GridColumn[] {
  const editable = resource.fields.filter(
    (field) => field.editable && CELL_KINDS.includes(field.kind as GridKind) && field.name !== "checklist",
  );
  const locked = resource.default_columns
    .map((name) => resource.fields.find((field) => field.name === name))
    .filter((field): field is NonNullable<typeof field> => Boolean(field && !field.editable && CELL_KINDS.includes(field.kind as GridKind)))
    .filter((field) => field.name !== resource.title_field);
  return [...editable, ...locked].map((field) => ({
    name: field.name,
    label: field.label,
    kind: field.kind as GridKind,
    editable: Boolean(field.editable),
    required: Boolean(field.required),
    minimum: field.minimum ?? null,
    maximum: field.maximum ?? null,
    choices: field.choices,
  }));
}

export default function RecordGridPage({ resourceKey }: { resourceKey: string }) {
  const back = useSmartBack();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const catalogue = useQuery({ queryKey: ["explorer-catalogue"], queryFn: ({ signal }) => explorerApi.catalogue(signal), staleTime: 60_000 });
  const resource = catalogue.data?.items.find((item) => item.key === resourceKey);
  const columns = useMemo(() => (resource ? gridColumns(resource) : []), [resource]);
  const filters = useMemo(() => {
    const out: Record<string, string> = {};
    params.forEach((value, key) => {
      if (!RESERVED.has(key) && value) out[key] = value;
    });
    return out;
  }, [params]);
  const q = params.get("q") ?? undefined;

  const rows = useQuery({
    queryKey: ["record-grid", resourceKey, filters, q, columns.map((c) => c.name)],
    enabled: Boolean(resource && columns.length),
    queryFn: async ({ signal }) => {
      const wanted = [...new Set([resource!.title_field, ...columns.map((c) => c.name), "updated_at"])];
      const out: GridRow[] = [];
      let total = 0;
      for (let page = 1; out.length < CAP; page += 1) {
        const result = await explorerApi.query(
          { resource_type: resourceKey, columns: wanted, filters, query_text: q, page, page_size: PAGE, sort: resource!.default_sort || "updated_at", order: "desc" },
          signal,
        );
        total = result.total;
        out.push(...(result.items as GridRow[]));
        if (result.items.length < PAGE) break;
      }
      return { items: out.slice(0, CAP), total };
    },
  });

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (catalogue.isError) return <FailureAlert error={catalogue.error} onRetry={() => void catalogue.refetch()} />;
  if (!resource) return <FailureAlert error={new Error("Unknown dataset")} titles={{ failed: "This dataset cannot be edited as a grid" }} />;

  const listPath = resource.path || `/${resourceKey}s`;
  const query = params.toString();
  return (
    <div data-testid="record-grid-page">
      <PageHeader
        title={<>{resource.label} <em>grid</em></>}
        subtitle="Edit many records at once — paste a block from Excel or a CSV, fill down, undo, then save in one go."
        onBack={() => back(`${listPath}${query ? `?${query}` : ""}`)}
        actions={<Button onClick={() => navigate(`${listPath}${query ? `?${query}` : ""}`)}>Back to the list</Button>}
      />
      {!resource.can_edit && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Your role can read these records but not edit them — the grid is read-only." />}
      {rows.data && rows.data.total > CAP && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message={`Showing the first ${CAP} of ${rows.data.total.toLocaleString()} — narrow the list's filters to edit the rest.`} />
      )}
      {rows.isError ? (
        <FailureAlert error={rows.error} onRetry={() => void rows.refetch()} />
      ) : rows.isLoading || !rows.data ? (
        <Skeleton active paragraph={{ rows: 12 }} />
      ) : (
        <RecordGrid
          resourceType={resourceKey}
          columns={columns}
          rows={rows.data.items}
          titleField={resource.title_field}
          canEdit={resource.can_edit}
        />
      )}
    </div>
  );
}
