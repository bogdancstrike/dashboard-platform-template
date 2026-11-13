/**
 * Projects as a portfolio table (§7, §48).
 *
 * This page was a Gantt: one bar per project from start to due, coloured by
 * health, with the budget burn beneath it. The shape was true — a project does
 * have a shape in time — but a reader could not get a *number* out of it. Two
 * bars overlapping in March is a fact about capacity; which of the two is
 * three weeks late and eleven points over its money is the fact somebody acts
 * on, and no amount of hovering a bar answers it for eight projects at once.
 *
 * So it is a table, and the columns are chosen to make the comparison the
 * timeline was reaching for readable down a column instead of across a row:
 * delivered, schedule used, budget used, side by side.
 *
 * **The standing is derived, never stored.** "Behind" is not a field — it is
 * what the gaps between those three numbers add up to, and the rule lives in
 * `entities/delivery.ts` with the delivery review that already uses it. Two
 * copies of "how far behind is too far" is two answers, and one of them would
 * be wrong the first time anybody changed it.
 *
 * Everything else — the metric strip, the filters, sorting, paging, export,
 * the create drawer — is the shared entity chrome, so this file holds the
 * project's *columns* and nothing about how a list works.
 */

import { Skeleton } from "antd";

import { NewRecordButton } from "@/components/records/useRecordEditing";
import { usePageCommands } from "@/commands/CommandContext";
import {
  EntityEmpty,
  EntityError,
  EntityFilters,
  EntityHeader,
  MetricStrip,
} from "@/entities/EntityChrome";
import { EntityTable, useEntityBulk, useEntityList } from "@/entities/list";

import { projectColumns } from "./columns";
import { COLUMNS, type ProjectRow } from "./types";

export default function ProjectsPortfolioPage() {
  const list = useEntityList<ProjectRow>("project", "/projects", {
    columns: COLUMNS,
    defaultSort: "due_date",
    defaultOrder: "asc",
  });
  const { view, records, navigate } = list;
  const bulk = useEntityBulk(view);

  usePageCommands("entity:project", [
    {
      id: "project.new",
      label: "Create a project",
      keywords: "new add create",
      run: records.create,
    },
    {
      id: "project.at-risk",
      label: "Show the projects that are at risk",
      keywords: "health red amber",
      run: () => view.setFilter("health", "AT_RISK"),
    },
    {
      id: "project.overspent",
      label: "Ask which projects are over budget",
      keywords: "budget spend overrun",
      run: () => navigate("/explore?resource=project"),
    },
  ]);

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="What each project has delivered, against the calendar it has used and the money it has spent."
        actions={<NewRecordButton records={records} resource={view.resource} />}
      />

      <MetricStrip view={view} accents={["accent", "danger", "info", "warning"]} />
      <EntityFilters view={view} only={["health", "phase", "status", "priority"]} />
      <EntityError view={view} />

      <EntityTable<ProjectRow>
        list={list}
        bulk={bulk}
        testIdOn="card"
        data-testid="project-table"
        columns={projectColumns(records)}
        // Fits the 1100px a 1440 desk leaves; wider, the pinned actions hid the due date.
        scroll={{ x: 1090 }}
        empty={
          <EntityEmpty
            view={view}
            title="No projects yet"
            hint="A project is work with a budget and a date."
            action={<NewRecordButton records={records} resource={view.resource} />}
          />
        }
      />

      {records.drawer}
      {bulk.dialog}
    </>
  );
}
