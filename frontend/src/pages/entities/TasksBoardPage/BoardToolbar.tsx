import { Button, Segmented, Select, Tooltip } from "antd";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthProvider";
import { SWIMLANES, useLaneSettings, type Swimlane } from "@/components/planning/BoardExtras";
import type { EntityView } from "@/entities/useEntityView";

import type { TasksBoard } from "./useTasksBoard";

/** The board's own controls: the other views, swimlanes, epic, mine, lane limits and the shortcuts. */
export function BoardToolbar({
  view,
  model,
  onLimits,
  onHelp,
}: {
  view: EntityView;
  model: TasksBoard;
  onLimits: () => void;
  onHelp: () => void;
}) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const laneSettings = useLaneSettings();
  const { filters, setFilter } = view;
  const { swim, epics } = model;

  return (
    <div className="nx-pl-toolbar" data-testid="board-toolbar">
      <Segmented
        aria-label="View"
        value="board"
        onChange={(value) => value !== "board" && navigate(`/${String(value)}`)}
        options={[
          { value: "board", label: "Board" },
          { value: "timeline", label: "Timeline" },
          { value: "sprints", label: "Sprints" },
        ]}
      />
      <Select
        aria-label="Swimlanes"
        data-testid="board-swimlanes"
        style={{ minWidth: 160 }}
        value={swim}
        onChange={(value: Swimlane) => view.set({ swim: value === "none" ? null : value })}
        options={SWIMLANES}
      />
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        aria-label="Epic"
        placeholder="Any epic"
        style={{ minWidth: 180 }}
        value={filters["epic_id"] || undefined}
        onChange={(value: string | undefined) => setFilter("epic_id", value ?? null)}
        options={(epics.data?.items ?? []).map((epic) => ({ value: epic.id, label: epic.title }))}
      />
      <Button
        type={filters["assignee_id"] && filters["assignee_id"] === profile?.user.id ? "primary" : "default"}
        onClick={() =>
          setFilter("assignee_id", filters["assignee_id"] === profile?.user.id ? null : (profile?.user.id ?? null))
        }
        data-testid="board-mine"
      >
        Only mine
      </Button>
      <span className="nx-pl-spacer" />
      {laneSettings.data?.can_manage && (
        <Button onClick={onLimits} data-testid="board-wip">
          Lane limits
        </Button>
      )}
      <Tooltip title="Keyboard shortcuts (?)">
        <Button aria-label="Keyboard shortcuts" onClick={onHelp}>
          ?
        </Button>
      </Tooltip>
    </div>
  );
}
