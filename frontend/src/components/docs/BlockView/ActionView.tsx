import { Button, Checkbox, Tooltip, Typography } from "antd";
import { Link } from "react-router-dom";

import type { DocBlock, LinkedTask } from "@/api/docs";
import { StatusTag } from "@/components/StatusTag";
import { PersonAvatar } from "@/components/PersonAvatar";
import { renderInline } from "@/components/collab/MarkdownLite";
import { initials } from "@/components/collab/MessageItem";

const { Text } = Typography;

export function ActionView({
  block,
  task,
  people,
  canCreate,
  creating,
  onCreateTask,
  onToggle,
}: {
  block: DocBlock;
  task?: LinkedTask;
  people: Record<string, string>;
  canCreate: boolean;
  creating: boolean;
  onCreateTask?: () => void;
  onToggle?: (done: boolean) => void;
}) {
  const done = task ? ["DONE", "CLOSED", "RESOLVED"].includes(task.status) : Boolean(block.done);
  const assignee = task?.assignee ?? (block.assignee_id ? people[block.assignee_id] : undefined);
  return (
    <div className={`nx-dc-action${done ? " is-done" : ""}`} data-testid="action-item">
      <Checkbox
        checked={done}
        disabled={Boolean(task) || !onToggle}
        onChange={(event) => onToggle?.(event.target.checked)}
        aria-label={block.text ? `Done: ${block.text}` : "Done"}
      />
      <span className="nx-dc-action-text">{block.text ? renderInline(block.text, block.id) : <Text type="secondary">An empty action item</Text>}</span>
      <span className="nx-dc-action-meta">
        {assignee && (
          <Tooltip title={`Assigned to ${assignee}`}>
            <span className="nx-dc-chip">
              <PersonAvatar size={18} initials={initials(assignee)} />
              {assignee.split(" ")[0]}
            </span>
          </Tooltip>
        )}
        {(task?.due_date ?? block.due_date) && (
          <span className="nx-dc-chip">due {(task?.due_date ?? block.due_date ?? "").slice(0, 10)}</span>
        )}
        {task ? (
          <Link to={`/tasks/${task.id}`} className="nx-dc-task" data-testid="action-task">
            <span className="nx-dc-ref">{task.reference}</span>
            <StatusTag status={task.status} />
          </Link>
        ) : block.task_id ? (
          <Text type="secondary">task removed</Text>
        ) : canCreate && onCreateTask && block.text ? (
          <Button onClick={onCreateTask} loading={creating} data-testid="create-task">
            Create task
          </Button>
        ) : null}
      </span>
    </div>
  );
}
