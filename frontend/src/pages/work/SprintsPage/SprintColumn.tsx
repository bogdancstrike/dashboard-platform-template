import { Button, Card, Dropdown, Skeleton } from "antd";
import { MoreOutlined } from "@ant-design/icons";

import { type Sprint } from "@/api/planning";
import { StatusTag } from "@/components/StatusTag";
import { DropGap } from "@/components/kanban/useBoardDrag";
import { PlanItem } from "@/components/planning/PlanItem";
import { shortDate } from "@/components/planning/gantt";
import "@/styles/planning.css";

import type { SprintsPageModel } from "./useSprintsPage";

/** One open sprint: its dates, goal and capacity, its actions, and the work planned into it — a drop target. */
export function SprintColumn({ m, sprint }: { m: SprintsPageModel; sprint: Sprint }) {
  const { navigate, setEditing, setCompleting, active, canManage, byId, epicName, listOf, drag, remove } = m;
  const detail = byId.get(sprint.id);
  const items = listOf(sprint.id);
  const points = items.reduce((sum, item) => sum + (item.story_points ?? 0), 0);
  const capacity = sprint.capacity_points;
  const over = capacity !== null && points > capacity;
  const lane = drag.laneProps(sprint.id);
  return (
    <Card className={`nx-pl-sprint nx-pl-dropzone ${lane.className}`} data-drop-lane={lane["data-drop-lane"]} data-testid={`sprint-${sprint.name}`}>
      <div className="nx-pl-sprint-head">
        <span className="nx-pl-sprint-name">{sprint.name}</span>
        <StatusTag status={sprint.state} label={sprint.state === "ACTIVE" ? "Running" : "Planned"} />
        <span className="nx-pl-spacer" />
        {canManage && sprint.state === "PLANNED" && (
          <Button type={active ? "default" : "primary"} disabled={Boolean(active)} onClick={() => setEditing({ mode: "start", sprint })} data-testid={`sprint-start-${sprint.name}`}>
            Start
          </Button>
        )}
        {canManage && sprint.state === "ACTIVE" && (
          <Button type="primary" onClick={() => setCompleting(sprint)} data-testid={`sprint-complete-${sprint.name}`}>
            Complete
          </Button>
        )}
        {canManage && (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "edit", label: "Edit" },
                ...(sprint.state === "PLANNED" ? [{ key: "delete", label: "Delete", danger: true }] : []),
              ],
              onClick: ({ key }) => {
                if (key === "edit") setEditing({ mode: "edit", sprint });
                else remove(sprint);
              },
            }}
          >
            <Button type="text" icon={<MoreOutlined />} aria-label={`More for ${sprint.name}`} />
          </Dropdown>
        )}
      </div>
      <div className="nx-pl-sprint-meta">
        <span>
          {sprint.start_date ? shortDate(sprint.start_date) : "No start"} – {sprint.end_date ? shortDate(sprint.end_date) : "no end"}
        </span>
        <span>{items.length} tasks</span>
        {sprint.state === "ACTIVE" && <span>{sprint.done_points} of {sprint.total_points} pts done</span>}
      </div>
      {sprint.goal && <p className="nx-pl-sprint-goal">{sprint.goal}</p>}
      <div className={`nx-pl-capacity${over ? " is-over" : ""}`} aria-label={`${points} of ${capacity ?? "no"} capacity points`}>
        <span>
          <strong>{points}</strong> pts{capacity !== null ? ` of ${capacity}` : ""}
        </span>
        {capacity !== null && (
          <span className="nx-pl-capacity-bar">
            <i style={{ width: `${Math.min(100, (points / Math.max(1, capacity)) * 100)}%` }} />
          </span>
        )}
        {over && <span>over capacity</span>}
      </div>
      {!detail ? (
        <Skeleton active title={false} paragraph={{ rows: 2 }} />
      ) : (
        <ul className="nx-pl-list" data-drop-list={sprint.id}>
          {items.length === 0 && drag.drag?.over.lane !== sprint.id ? (
            <li className="nx-pl-empty">Drag work here from the backlog</li>
          ) : (
            drag.renderLane(
              sprint.id,
              items,
              (item) => item.id,
              (item) => (
                <li key={item.id}>
                  <PlanItem
                    item={item}
                    epicName={item.epic_id ? epicName.get(item.epic_id) : undefined}
                    drag={drag.cardProps(item.id, sprint.id)}
                    onOpen={() => navigate(`/tasks/${item.id}`)}
                  />
                </li>
              ),
              (height) => <DropGap key="gap" height={Math.min(height, 44)} label="joins this sprint" />,
            )
          )}
        </ul>
      )}
    </Card>
  );
}
