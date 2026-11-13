import { Button } from "antd";

import type { Week, WeekRow } from "@/api/time";
import { SubjectPicker, parseSubjectKey } from "@/components/decisions/SubjectPicker";

/** Pick a work item to add as an empty row of the grid. */
export function AddRow({ data, onAdd, onClose }: { data: Week; onAdd: (row: WeekRow) => void; onClose: () => void }) {
  return (
    <div className="nx-td-bar" style={{ marginTop: 10 }}>
      <div className="nx-td-grow">
        <SubjectPicker
          autoFocus
          onChange={(value, subject) => {
            const chosen = parseSubjectKey(value);
            if (chosen) {
              onAdd({
                ...chosen, label: subject?.label ?? "", link: null,
                cells: Object.fromEntries(data.days.map((day) => [day, 0])),
                fixed: Object.fromEntries(data.days.map((day) => [day, 0])), total: 0, billable_minutes: 0,
              });
            }
            onClose();
          }}
        />
      </div>
      <Button onClick={onClose}>Cancel</Button>
    </div>
  );
}
