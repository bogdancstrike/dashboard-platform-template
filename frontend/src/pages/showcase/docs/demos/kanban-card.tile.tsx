import type { KanbanCard, KanbanLane } from "@/api/kanban";
import { KanbanCardTile } from "@/components/kanban/KanbanCardTile";

const LANE: KanbanLane = { id: "lane", name: "In progress", position: 1, wip_limit: 3, is_done: false, total: 4, over_limit: true, cards: [] };

const CARD: KanbanCard = {
  id: "card-demo",
  board_id: "board",
  lane_id: "lane",
  reference: "PLAT-00042",
  kind: "BUG",
  title: "Export times out above 50 000 rows",
  description: null,
  parent_id: null,
  position: 0,
  priority: "HIGH",
  story_points: 5,
  assignee: { id: "user-1", name: "Ada Administrator", initials: "AA" },
  labels: ["exports", "performance"],
  due_date: "2026-09-04T09:00:00Z",
  started_at: null,
  completed_at: null,
  checklist: [
    { text: "Reproduce", done: true },
    { text: "Fix", done: false },
  ],
  checklist_done: 1,
  comment_count: 2,
  created_at: "2026-08-20T09:00:00Z",
  updated_at: "2026-09-01T09:00:00Z",
};

export default function KanbanCardTileDemo() {
  return (
    <div style={{ maxWidth: 300 }}>
      <KanbanCardTile
        card={CARD}
        canEdit
        lanes={[LANE]}
        currentLane={LANE}
        index={0}
        laneSize={3}
        onOpen={() => {}}
        onMoveWithin={() => {}}
        onMoveToLane={() => {}}
      />
    </div>
  );
}
