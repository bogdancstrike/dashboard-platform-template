import { useQuery } from "@tanstack/react-query";
import { Form, Select } from "antd";

import { explorerApi } from "@/api/explorer";
import { insightsApi } from "@/api/insights";
import { reportsApi } from "@/api/reports";
import { STALE, queryKeys } from "@/lib/queryKeys";

import type { KindSpec } from "../../kinds";

type Saved = Extract<KindSpec["needs"], "report" | "search" | "insight">;

interface Option {
  value: string;
  label: string;
}

/**
 * What the reader has already made, for the kinds that draw one. Fetched only
 * when such a kind is chosen — this field is not drawn otherwise — so opening
 * the modal for a KPI costs nothing.
 */
function useSaved(needs: Saved): { loading: boolean; options: Option[] } {
  const reports = useQuery({
    queryKey: queryKeys.reports(),
    queryFn: ({ signal }) => reportsApi.list(signal),
    enabled: needs === "report",
    staleTime: STALE.minute,
  });
  const insights = useQuery({
    queryKey: queryKeys.insights(),
    queryFn: ({ signal }) => insightsApi.list({}, signal),
    enabled: needs === "insight",
    staleTime: STALE.minute,
  });
  const searches = useQuery({
    queryKey: queryKeys.savedSearches("all"),
    queryFn: ({ signal }) => explorerApi.saved(undefined, signal),
    enabled: needs === "search",
    staleTime: STALE.minute,
  });
  if (needs === "report") {
    return {
      loading: reports.isLoading,
      options: (reports.data?.items ?? []).map((item) => ({
        value: item.id,
        label: `${item.name} · ${item.visualization}`,
      })),
    };
  }
  if (needs === "search") {
    return {
      loading: searches.isLoading,
      options: (searches.data?.items ?? []).map((item) => ({
        value: item.id,
        label: `${item.name} · ${item.resource_type}`,
      })),
    };
  }
  return {
    loading: insights.isLoading,
    options: (insights.data?.items ?? []).map((item) => ({ value: item.id, label: item.title })),
  };
}

/** How each saved kind asks for its subject. */
const FIELDS: Record<
  Saved,
  { name: string; label: string; aria: string; message: string; extra: string; none: string }
> = {
  insight: {
    name: "insight_id",
    label: "Which insight",
    aria: "Insight",
    message: "Pick an insight to show",
    extra: "Its numbers are re-read every time the dashboard opens.",
    none: "You have not saved an insight yet",
  },
  report: {
    name: "report_id",
    label: "Which report",
    aria: "Report",
    message: "Pick a report to draw",
    extra:
      "Drawn the way the report itself says it should be. Editing the report takes its widgets with it.",
    none: "You have not saved a report yet",
  },
  search: {
    name: "search_id",
    label: "Which search",
    aria: "Saved search",
    message: "Pick a saved search to answer",
    extra: "Answered through the explorer query, under the same permissions.",
    none: "You have not saved a search yet",
  },
};

/** The one field a saved kind asks: which of the reader's own things it draws. */
export function SavedSubjectField({ needs }: { needs: Saved }) {
  const field = FIELDS[needs];
  const { loading, options } = useSaved(needs);
  return (
    <Form.Item
      name={field.name}
      label={field.label}
      rules={[{ required: true, message: field.message }]}
      extra={field.extra}
    >
      <Select
        aria-label={field.aria}
        loading={loading}
        options={options}
        notFoundContent={loading ? "Loading…" : field.none}
      />
    </Form.Item>
  );
}

/** Whether a kind's subject is one of the reader's saved things. */
export function isSaved(needs: KindSpec["needs"]): needs is Saved {
  return needs === "report" || needs === "search" || needs === "insight";
}
