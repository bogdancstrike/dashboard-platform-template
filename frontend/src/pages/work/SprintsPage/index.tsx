/**
 * `/sprints` — backlog, sprint planning, the running sprint's board, and how
 * the sprints went (§18). Jira's and Taiga's shape, over the one work queue.
 *
 * **Planning is dragging.** The backlog and every open sprint are drop lists on
 * one drag engine (`useBoardDrag`, the board's): a task dropped into a sprint
 * joins it, one dropped back leaves it, and the order inside each list is a
 * hand-made rank the server keeps — a drop writes one row.
 *
 * **The board is the task board's**, narrowed to the running sprint: lanes are
 * the status vocabulary and a drop is the same `place` write `/tasks` makes.
 *
 * **Reports** are the burndown (daily snapshots against the ideal line), the
 * velocity across the last sprints, and what each completed sprint delivered,
 * carried over and absorbed after it started.
 *
 * The project is a filter (replaced in the address); the tab and the sprint a
 * report shows are places (pushed), so back walks them.
 */

import { Button, Card, Segmented, Select, Skeleton, Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { EmptyState } from "@/components/EmptyState";
import { FailureAlert } from "@/components/FailureAlert";
import { PageHeader } from "@/components/PageHeader";
import { StatusTag } from "@/components/StatusTag";
import { CompleteSprintModal, SprintFormModal } from "@/components/planning/SprintModals";
import { projectOptions } from "@/components/planning/useProjects";
import "@/styles/planning.css";

import { SprintBoard } from "./SprintBoard";
import { SprintReports } from "./SprintReports";

import { SprintPlanning } from "./SprintPlanning";
import { useSprintsPage } from "./useSprintsPage";

export default function SprintsPage() {
  const m = useSprintsPage();
  const { navigate, screens, params, set, projects, editing, setEditing, completing, setCompleting, tab, project, sprints, all, active, canManage, byId, refresh, save, complete, hasNext, loading } = m;

  return (
    <>
      <PageHeader
        title={
          <>
            Sprint <em>planning</em>
          </>
        }
        subtitle="A ranked backlog, time boxes drawn from it, and how each one went."
        actions={
          <>
            <Select
              showSearch
              optionFilterProp="label"
              aria-label="Project"
              data-testid="sprints-project"
              placeholder="Choose a project"
              style={{ minWidth: screens.md ? 260 : 170 }}
              loading={projects.isLoading}
              value={project || undefined}
              onChange={(value: string) => set({ project: value, sprint: null })}
              options={projectOptions(projects.data)}
            />
            <Tooltip title={canManage ? "" : "Your role does not include tasks.manage"}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canManage}
                onClick={() => setEditing({ mode: "create", sprint: null })}
                data-testid="sprint-new"
              >
                New sprint
              </Button>
            </Tooltip>
          </>
        }
      />

      <div className="nx-pl-toolbar">
        <Segmented
          aria-label="View"
          value={tab}
          onChange={(value) => set({ tab: value === "plan" ? null : String(value) })}
          options={[
            { value: "plan", label: "Backlog & planning" },
            { value: "board", label: active ? `Board · ${active.name.replace(/^.*?(Sprint)/, "$1")}` : "Board" },
            { value: "reports", label: "Reports" },
          ]}
          data-testid="sprints-tabs"
        />
        <span className="nx-pl-spacer" />
        {active && (
          <span className="nx-pl-legend">
            <StatusTag status="ACTIVE" label="Running" /> {active.name} · {active.days_left ?? 0} days left
          </span>
        )}
      </div>

      {sprints.isError ? (
        <FailureAlert error={sprints.error} onRetry={() => void sprints.refetch()} />
      ) : loading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : tab === "plan" ? (
        <SprintPlanning m={m} />
      ) : tab === "board" ? (
        active && byId.get(active.id) ? (
          <SprintBoard sprint={byId.get(active.id)!} onOpen={(id) => navigate(`/tasks/${id}`)} onChanged={refresh} />
        ) : (
          <Card>
            <EmptyState
              title="No sprint is running"
              hint="Start a planned sprint to work it on a board."
              action={<Button onClick={() => set({ tab: null })}>Go to planning</Button>}
            />
          </Card>
        )
      ) : (
        <SprintReports project={project} sprints={all} chosen={params.get("sprint")} onChoose={(id) => set({ sprint: id })} />
      )}

      <SprintFormModal
        open={editing !== null}
        mode={editing?.mode}
        sprint={editing?.sprint}
        saving={save.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(values) => editing && save.mutate({ mode: editing.mode, sprint: editing.sprint, values })}
      />
      <CompleteSprintModal
        open={completing !== null}
        sprint={completing}
        unfinished={completing ? (byId.get(completing.id)?.tasks ?? []).filter((item) => !["DONE", "CANCELLED"].includes(item.status)).length : 0}
        hasNext={hasNext}
        saving={complete.isPending}
        onClose={() => setCompleting(null)}
        onSubmit={(carry) => completing && complete.mutate({ sprint: completing, carry })}
      />
    </>
  );
}
