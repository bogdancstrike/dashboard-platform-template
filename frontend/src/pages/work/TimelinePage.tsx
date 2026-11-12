/**
 * `/timeline` — the work queue as a Gantt chart (§18).
 *
 * Grouped by project, epic or person; zoomed by day, week, month or quarter;
 * every bar draggable, every end resizable, every dependency drawn. The
 * address carries the view (replaced, never pushed — a zoom is an adjustment,
 * not a place), so a link to it opens the same chart.
 */

import { Button } from "antd";
import { useNavigate } from "react-router-dom";

import type { TimelineGrouping } from "@/api/planning";
import { PageHeader } from "@/components/PageHeader";
import { PlanIcon } from "@/components/planning/planIcons";
import { DEFAULT_TIMELINE, TimelineView, type TimelineState } from "@/components/planning/TimelineView";
import { ZOOMS, type Zoom } from "@/components/planning/gantt";
import { useUrlState } from "@/components/planning/useUrlState";
import { usePageCommands } from "@/commands/CommandContext";
import "@/styles/planning.css";

const GROUPS: TimelineGrouping[] = ["project", "epic", "assignee"];

export default function TimelinePage() {
  const navigate = useNavigate();
  const { params, set } = useUrlState();
  const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;

  const state: TimelineState = {
    group: pick(params.get("group"), GROUPS, DEFAULT_TIMELINE.group),
    zoom: pick(params.get("zoom"), Object.keys(ZOOMS) as Zoom[], DEFAULT_TIMELINE.zoom),
    project: params.get("project") ?? "",
    q: params.get("q") ?? "",
    done: params.get("done") !== "0",
    critical: params.get("critical") !== "0",
  };

  const onChange = (changes: Partial<TimelineState>) =>
    set({
      ...(changes.group !== undefined ? { group: changes.group === "project" ? null : changes.group } : {}),
      ...(changes.zoom !== undefined ? { zoom: changes.zoom === "week" ? null : changes.zoom } : {}),
      ...(changes.project !== undefined ? { project: changes.project } : {}),
      ...(changes.q !== undefined ? { q: changes.q } : {}),
      ...(changes.done !== undefined ? { done: changes.done ? null : "0" } : {}),
      ...(changes.critical !== undefined ? { critical: changes.critical ? null : "0" } : {}),
    });

  usePageCommands("timeline", [
    { id: "timeline.critical", label: "Highlight the critical path", keywords: "gantt slack chain", run: () => onChange({ critical: true }) },
    { id: "timeline.months", label: "Zoom the timeline to months", keywords: "gantt zoom out", run: () => onChange({ zoom: "month" }) },
    { id: "timeline.people", label: "Show the timeline by person", keywords: "assignee gantt", run: () => onChange({ group: "assignee" }) },
  ]);

  return (
    <>
      <PageHeader
        title={
          <>
            Project <em>timeline</em>
          </>
        }
        subtitle="Every piece of work in time — drag to reschedule, link to sequence, and see what the end date hangs on."
        actions={
          <>
            <Button icon={<PlanIcon name="sprint" size={16} />} onClick={() => navigate("/sprints")}>
              Sprints
            </Button>
            <Button onClick={() => navigate("/tasks")}>Board</Button>
          </>
        }
      />
      <TimelineView state={state} onChange={onChange} />
    </>
  );
}
