import { Card, Progress, Space, Typography } from "antd";

import { ReorderableChecklist } from "@/components/planning/TaskPlanning";
import type { RecordPage } from "@/components/records/useRecordPage";

const { Text } = Typography;

/** One line of the card's to-do list, as the record stores it. */
interface ChecklistItem {
  text: string;
  done: boolean;
}

/** The task's to-do list: how much of it is done, and the items, reorderable by whoever may edit. */
export function ChecklistCard({ page }: { page: RecordPage }) {
  const task = page.record!;
  // Older rows were seeded as `{label, done}`; the field's contract is
  // `{text, done}`, so read either and write the contract back.
  const checklist = ((page.value("checklist") as (ChecklistItem & { label?: string })[] | null) ?? []).map(
    (item) => ({ text: item.text || item.label || "", done: Boolean(item.done) }),
  );
  const done = checklist.filter((item) => item.done).length;

  const writeChecklist = (items: ChecklistItem[]) => page.write({ checklist: items });

  return (
    <Card
      size="small"
      className="nu-block"
      title={
        <Space size={8}>
          <span>Checklist</span>
          {checklist.length > 0 && (
            <Text type="secondary" data-testid="checklist-progress">
              {done} of {checklist.length}
            </Text>
          )}
        </Space>
      }
      data-testid="task-checklist"
    >
      {checklist.length > 0 && (
        <Progress
          aria-label={`Checklist: ${done} of ${checklist.length} done`}
          className="nu-block nu-gauge"
          percent={Math.round((done / checklist.length) * 100)}
          size="small"
        />
      )}
      <ReorderableChecklist
        items={checklist}
        canEdit={Boolean(task.can_edit)}
        saving={page.writing}
        onChange={writeChecklist}
      />
    </Card>
  );
}
