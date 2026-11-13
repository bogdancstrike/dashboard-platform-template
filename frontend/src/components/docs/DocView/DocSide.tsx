import { Button, Card, Typography } from "antd";
import { LinkOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { PersonAvatar } from "@/components/PersonAvatar";
import { initials } from "@/components/collab/MessageItem";
import { absoluteTime, relativeTime } from "@/lib/time";

import { recordPath, RECORD_LABELS } from "../blocks";

import type { DocViewModel } from "./useDocView";

const { Text } = Typography;

/** The side column: the meeting it notes, its action items, its links and the page facts. */
export function DocSide({ m }: { m: DocViewModel }) {
  const { setLinking, unlink } = m;
  const data = m.data!;
  const actions = data.blocks.filter((block) => block.kind === "action" && block.text);
  return (
    <aside className="nx-dc-side">
      {data.event && (
        <Card className="nx-dc-card is-side" title="Meeting" size="small" data-testid="doc-meeting">
          <strong>{data.event.title}</strong>
          <div className="nx-co-muted">
            {absoluteTime(data.event.starts_at)}
            {data.event.location ? ` · ${data.event.location}` : ""}
          </div>
          <ul className="nx-dc-people">
            {data.event.participants.map((person, index) => (
              <li key={person.user_id ?? index}>
                <PersonAvatar size={20} initials={initials(person.name ?? "?")} />
                <span>{person.name ?? "Somebody"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {actions.length > 0 && (
        <Card className="nx-dc-card is-side" title={`Action items · ${actions.length}`} size="small">
          <ul className="nx-dc-side-list">
            {actions.map((block) => {
              const task = block.task_id ? data.tasks[block.task_id] : undefined;
              return (
                <li key={block.id}>
                  <span>{block.text}</span>
                  {task ? (
                    <Link to={`/tasks/${task.id}`} className="nx-co-muted">
                      {task.reference} · {task.status.toLowerCase().replace(/_/g, " ")}
                    </Link>
                  ) : (
                    <span className="nx-co-muted">not a task yet</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Card
        className="nx-dc-card is-side"
        size="small"
        title="Linked records"
        extra={
          data.can_edit && (
            <Button type="text" icon={<LinkOutlined />} onClick={() => setLinking(true)} data-testid="link-record">
              Link
            </Button>
          )
        }
        data-testid="doc-links"
      >
        {data.links.length === 0 ? (
          <Text type="secondary">Nothing linked. A record mentioned in the page is linked by itself.</Text>
        ) : (
          <ul className="nx-dc-side-list">
            {data.links.map((item) => (
              <li key={item.id}>
                <Link to={recordPath(item.resource_type, item.resource_id)}>
                  <Text type="secondary">{RECORD_LABELS[item.resource_type] ?? item.resource_type}</Text> {item.label}
                </Link>
                <span className="nx-dc-link-meta">
                  <Text type="secondary">{item.source === "MANUAL" ? "linked" : item.source === "MENTION" ? "mentioned" : "action"}</Text>
                  {data.can_edit && item.source === "MANUAL" && (
                    <Button type="text" aria-label={`Unlink ${item.label}`} onClick={() => unlink.mutate(item.id)}>
                      ×
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="nx-dc-card is-side" size="small" title="About this page">
        <dl className="nx-dc-about">
          <dt>Created</dt>
          <dd>
            {data.created_by?.name ?? "Somebody"} · {relativeTime(data.created_at)}
          </dd>
          <dt>Version</dt>
          <dd>{data.version}</dd>
          {data.template && (
            <>
              <dt>Template</dt>
              <dd>{data.template}</dd>
            </>
          )}
        </dl>
      </Card>
    </aside>
  );
}
