import { Card, Input, Skeleton, Space, Tag } from "antd";

import { DropGap } from "@/components/kanban/useBoardDrag";
import { PlanItem, Points } from "@/components/planning/PlanItem";
import "@/styles/planning.css";

import { BACKLOG } from "./constants";

import type { SprintsPageModel } from "./useSprintsPage";

/** The ranked backlog: drag to rank, or into a sprint to plan it. */
export function BacklogCard({ m }: { m: SprintsPageModel }) {
  const { navigate, screens, term, setTerm, canManage, backlog, epicName, listOf, drag } = m;
  return (
    <Card
      className={`nx-pl-dropzone ${drag.laneProps(BACKLOG).className}`}
      data-drop-lane={BACKLOG}
      data-testid="backlog"
      title={
        <Space size={8}>
          <span>Backlog</span>
          <Tag>{backlog.data?.total ?? 0} items</Tag>
          <Points value={backlog.data?.total_points ?? 0} />
        </Space>
      }
    >
      <Input.Search
        allowClear
        aria-label="Search the backlog"
        placeholder="Search the backlog"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        style={{ marginBottom: 10 }}
      />
      {canManage && (
        <p className="nu-muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
          Drag to rank, or into a sprint to plan it. Space picks a focused row up; the arrows move it.
        </p>
      )}
      {backlog.isLoading ? (
        <Skeleton active title={false} paragraph={{ rows: 6 }} />
      ) : (
        <ul className="nx-pl-list" data-drop-list={BACKLOG} data-drag-scroll style={{ maxHeight: screens.lg ? "calc(100vh - 330px)" : undefined, overflow: "auto" }}>
          {listOf(BACKLOG).length === 0 && drag.drag?.over.lane !== BACKLOG ? (
            <li className="nx-pl-empty">The backlog is empty — everything open is planned.</li>
          ) : (
            drag.renderLane(
              BACKLOG,
              listOf(BACKLOG),
              (item) => item.id,
              (item) => (
                <li key={item.id}>
                  <PlanItem
                    item={item}
                    epicName={item.epic_id ? epicName.get(item.epic_id) : undefined}
                    drag={drag.cardProps(item.id, BACKLOG)}
                    onOpen={() => navigate(`/tasks/${item.id}`)}
                  />
                </li>
              ),
              (height) => <DropGap key="gap" height={Math.min(height, 44)} label="back to the backlog" />,
            )
          )}
        </ul>
      )}
    </Card>
  );
}
