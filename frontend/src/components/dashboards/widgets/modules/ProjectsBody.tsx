import { useQuery } from "@tanstack/react-query";
import { Progress, Typography } from "antd";
import { Link } from "react-router-dom";

import { explorerApi } from "@/api/explorer";
import { asText } from "@/lib/text";
import { knownStatusColor } from "@/theme/tokens";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { Loading, MoreLink, Nothing, ROWS, type ModuleBodyProps } from "./shared";

const { Text } = Typography;

/**
 * Delivery, project by project.
 *
 * A progress bar per row rather than a status tag, because "how far along" is
 * the question a portfolio is read for and a state name answers it only
 * coarsely — `IN_PROGRESS` covers a project at 5% and one at 95%.
 */
export function ProjectsBody({ widget, fallback }: ModuleBodyProps) {
  const filters: Record<string, unknown> = { ...(widget.config.filters ?? {}) };
  if (widget.config.status) filters["status"] = widget.config.status;

  const request = {
    resource_type: "project",
    filters,
    columns: ["name", "status", "progress", "health", "end_date"],
    sort: "updated_at",
    order: "desc" as const,
    page_size: ROWS,
  };

  const rows = useQuery({
    queryKey: queryKeys.entityRows(request),
    queryFn: ({ signal }) => explorerApi.query(request, signal),
    staleTime: STALE.short,
  });

  if (rows.isLoading) return <Loading />;
  if (rows.isError) return fallback(rows.error, "project");

  const items = rows.data?.items ?? [];
  if (items.length === 0) return <Nothing what="No projects match" />;

  return (
    <>
      <ul className="nu-widget-projects">
        {items.map((row) => {
          const done = Math.round(Number(row["progress"] ?? 0));
          return (
            <li key={row.id}>
              <Link to={`/projects/${row.id}`} className="nu-widget-project">
                <span className="nu-widget-project-head">
                  <Text ellipsis>{asText(row["name"])}</Text>
                  <Text type="secondary" className="nu-widget-dim">
                    {done}%
                  </Text>
                </span>
                <Progress
                  percent={done}
                  size="small"
                  showInfo={false}
                  strokeColor={knownStatusColor(asText(row["status"])) ?? undefined}
                  aria-label={`${asText(row["name"])}: ${done}% complete`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
      <MoreLink to="/projects">All {(rows.data?.total ?? 0).toLocaleString()} projects</MoreLink>
    </>
  );
}
