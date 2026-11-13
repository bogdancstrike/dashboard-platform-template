import { Button, Card } from "antd";

import { EmptyState } from "@/components/EmptyState";
import "@/styles/planning.css";

import type { SprintsPageModel } from "./useSprintsPage";

import { BacklogCard } from "./BacklogCard";
import { SprintColumn } from "./SprintColumn";

/** The open sprints beside the backlog, with the drag between them. */
export function SprintPlanning({ m }: { m: SprintsPageModel }) {
  const { setEditing, open, canManage, drag } = m;
  return (
    <div className="nx-pl-sprint-grid" data-testid="sprint-planning">
      <div>
        {open.length === 0 && (
          <Card className="nx-pl-sprint">
            <EmptyState
              title="No sprint planned"
              hint="Plan one, then drag work into it from the backlog."
              action={
                canManage ? (
                  <Button type="primary" onClick={() => setEditing({ mode: "create", sprint: null })}>
                    Plan a sprint
                  </Button>
                ) : undefined
              }
            />
          </Card>
        )}
        {open.map((sprint) => (
          <SprintColumn key={sprint.id} m={m} sprint={sprint} />
        ))}
      </div>

      <BacklogCard m={m} />
      {drag.overlay}
    </div>
  );
}
