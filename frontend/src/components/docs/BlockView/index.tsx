/**
 * A wiki block as a reader sees it (§48).
 *
 * The data blocks are the report builder's: a `chart` block is drawn by the
 * same `BlockPreview` a report document uses, through the same analysis
 * compiler, so the chart in a runbook and the chart in a PDF report are one
 * answer drawn twice. An action item shows the live state of the task it
 * became — or the button that makes it one.
 */

import { Checkbox, Typography } from "antd";
import { Link } from "react-router-dom";

import type { DocBlock, LinkedTask } from "@/api/docs";
import { BlockPreview } from "@/components/documents/DocumentBlocks";
import { MarkdownLite, renderInline } from "@/components/collab/MarkdownLite";

import { itemText, RECORD_LABELS, recordPath } from "../blocks";

import { ActionView } from "./ActionView";
import { ImageBlock, asReportBlock } from "./ImageBlock";

export { ActionView } from "./ActionView";

const { Title, Text } = Typography;

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
