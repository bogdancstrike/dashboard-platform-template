import { Alert, Button, Space } from "antd";

import { shortDate } from "../gantt";

import type { Warning } from "./useTimeline";

/** A move that left a dependant starting before its predecessor ends — shift them along, or keep it. */
export function ScheduleWarning({
  warning,
  canEdit,
  compact,
  onShift,
  onDismiss,
}: {
  warning: Warning;
  canEdit: boolean;
  compact: boolean;
  onShift: () => void;
  onDismiss: () => void;
}) {
  return (
    <Alert
      className="nx-pl-warning"
      type="warning"
      showIcon
      data-testid="timeline-warning"
      message={`${warning.bar.reference} now overlaps ${warning.violations.length === 1 ? "a task that waits on it" : `${warning.violations.length} dependencies`}`}
      description={
        <ul>
          {warning.violations.map((item) => (
            <li key={item.dependency_id}>
              {item.successor.reference} {item.successor.title} starts {shortDate(item.successor.start)}, before{" "}
              {item.predecessor.reference} ends {shortDate(item.predecessor.end)}.
            </li>
          ))}
        </ul>
      }
      action={
        canEdit ? (
          <Space direction={compact ? "vertical" : "horizontal"}>
            {warning.violations.some((item) => item.side === "successor") && (
              <Button
                type="primary"
                data-testid="timeline-shift"
                onClick={onShift}
              >
                Shift dependants
              </Button>
            )}
            <Button onClick={onDismiss}>
              Keep as is
            </Button>
          </Space>
        ) : undefined
      }
      closable
      onClose={onDismiss}
    />
  );
}
