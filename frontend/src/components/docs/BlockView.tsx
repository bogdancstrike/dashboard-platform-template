/**
 * A wiki block as a reader sees it (§48).
 *
 * The data blocks are the report builder's: a `chart` block is drawn by the
 * same `BlockPreview` a report document uses, through the same analysis
 * compiler, so the chart in a runbook and the chart in a PDF report are one
 * answer drawn twice. An action item shows the live state of the task it
 * became — or the button that makes it one.
 */

import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Image, Skeleton, Tooltip, Typography } from "antd";
import { Link } from "react-router-dom";

import type { DocBlock, LinkedTask } from "@/api/docs";
import { filesApi } from "@/api/files";
import { BlockPreview } from "@/components/documents/DocumentBlocks";
import type { DocumentBlock } from "@/api/reportDocuments";
import { StatusTag } from "@/components/StatusTag";
import { PersonAvatar } from "@/components/PersonAvatar";
import { MarkdownLite, renderInline } from "@/components/collab/MarkdownLite";
import { initials } from "@/components/collab/MessageItem";

import { itemText, RECORD_LABELS, recordPath } from "./blocks";

const { Title, Text } = Typography;

export function asReportBlock(block: DocBlock): DocumentBlock {
  return {
    ...(block as unknown as DocumentBlock),
    id: block.id,
    kind: block.kind === "report" ? "REPORT" : "CHART",
  };
}

function ImageBlock({ block }: { block: DocBlock }) {
  const url = useQuery({
    queryKey: ["file-preview", block.file_id],
    queryFn: ({ signal }) => filesApi.previewUrl(block.file_id!, signal),
    enabled: Boolean(block.file_id),
    staleTime: 240_000,
    retry: false,
  });
  if (!block.file_id) return <Text type="secondary">No image chosen yet.</Text>;
  if (url.isLoading) return <Skeleton.Image active />;
  return (
    <figure className="nx-dc-figure">
      {url.data ? (
        <Image src={url.data.download.url} alt={block.caption || url.data.file.name} />
      ) : (
        <Text type="secondary">The image could not be loaded.</Text>
      )}
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  );
}

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

export function BlockView({
  block,
  tasks,
  people,
  canCreateTasks = false,
  creatingTask,
  onCreateTask,
  onToggleAction,
  onToggleCheck,
}: {
  block: DocBlock;
  tasks: Record<string, LinkedTask>;
  people: Record<string, string>;
  canCreateTasks?: boolean;
  creatingTask?: string | null;
  onCreateTask?: (blockId: string) => void;
  onToggleAction?: (blockId: string, done: boolean) => void;
  onToggleCheck?: (blockId: string, index: number, done: boolean) => void;
}) {
  switch (block.kind) {
    case "heading":
      return (
        <Title level={Math.min(4, (block.level ?? 2) + 1) as 2 | 3 | 4} className={`nx-dc-h nx-dc-h${block.level ?? 2}`}>
          {block.text || <Text type="secondary">Untitled section</Text>}
        </Title>
      );
    case "text":
      return block.text ? <MarkdownLite text={block.text} className="nx-dc-text" /> : <div className="nx-dc-empty-line" />;
    case "quote":
      return <blockquote className="nx-dc-quote">{renderInline(block.text ?? "", block.id)}</blockquote>;
    case "callout":
      return (
        <div className={`nx-dc-callout is-${block.tone ?? "info"}`} role="note">
          <MarkdownLite text={block.text ?? ""} />
        </div>
      );
    case "code":
      return (
        <pre className="nx-dc-code" data-language={block.language || undefined}>
          <code>{block.text}</code>
        </pre>
      );
    case "list": {
      const items = (block.items ?? []).map(itemText).filter((item) => item.trim());
      if (items.length === 0) return null;
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag className="nx-dc-list">
          {items.map((item, index) => (
            <li key={index}>{renderInline(item, `${block.id}-${index}`)}</li>
          ))}
        </Tag>
      );
    }
    case "checklist":
      return (
        <ul className="nx-dc-checklist">
          {(block.items ?? []).map((raw, index) => {
            const item = typeof raw === "string" ? { text: raw, done: false } : raw;
            return (
              <li key={index} className={item.done ? "is-done" : undefined}>
                <Checkbox
                  checked={item.done}
                  disabled={!onToggleCheck}
                  onChange={(event) => onToggleCheck?.(block.id, index, event.target.checked)}
                >
                  {renderInline(item.text, `${block.id}-${index}`)}
                </Checkbox>
              </li>
            );
          })}
        </ul>
      );
    case "table": {
      const rows = block.rows ?? [];
      const [head, ...body] = block.header ? rows : [undefined, ...rows];
      return (
        <div className="nx-dc-table-wrap">
          <table className="nx-dc-table">
            {head && (
              <thead>
                <tr>
                  {head.map((cell, index) => (
                    <th key={index}>{cell}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, index) => (
                <tr key={index}>
                  {(row ?? []).map((cell, at) => (
                    <td key={at}>{renderInline(cell, `${block.id}-${index}-${at}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "divider":
      return <hr className="nx-dc-rule" />;
    case "image":
      return <ImageBlock block={block} />;
    case "chart":
    case "report":
      return (
        <div className="nx-dc-data">
          {/* The report builder's preview draws the caption itself. */}
          <BlockPreview block={asReportBlock(block)} resources={[]} onChart={() => undefined} />
        </div>
      );
    case "record":
      return block.resource_id ? (
        <Link className="nx-dc-record" to={recordPath(block.resource_type ?? "", block.resource_id)} data-testid="record-mention">
          <span className="nx-dc-record-kind">{RECORD_LABELS[block.resource_type ?? ""] ?? block.resource_type}</span>
          <span>{block.label || block.resource_id}</span>
        </Link>
      ) : (
        <Text type="secondary">No record chosen yet.</Text>
      );
    case "action":
      return (
        <ActionView
          block={block}
          task={block.task_id ? tasks[block.task_id] : undefined}
          people={people}
          canCreate={canCreateTasks}
          creating={creatingTask === block.id}
          onCreateTask={onCreateTask ? () => onCreateTask(block.id) : undefined}
          onToggle={onToggleAction ? (done) => onToggleAction(block.id, done) : undefined}
        />
      );
    default:
      return null;
  }
}
