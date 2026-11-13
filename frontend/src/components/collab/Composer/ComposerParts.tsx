import { Button, Progress } from "antd";
import { PaperClipOutlined, CloseOutlined } from "@ant-design/icons";

import { type Person } from "@/api/directory";
import { readableSize } from "@/api/files";
import { PersonAvatar } from "@/components/PersonAvatar";
import type { Pending } from "./mentions";

/** The files on their way with the message: progress, an error, or ready — each removable. */
export function PendingFiles({ pending, onRemove }: { pending: Pending[]; onRemove: (key: string) => void }) {
  if (pending.length === 0) return null;
  return (
    <ul className="nx-co-pending" aria-label="Files to send">
      {pending.map((item) => (
        <li key={item.key} className={item.error ? "is-bad" : undefined}>
          <PaperClipOutlined />
          <span className="nx-co-pending-name">{item.name}</span>
          <span className="nx-co-muted">{readableSize(item.size)}</span>
          {!item.file && !item.error && <Progress percent={item.progress} size="small" showInfo={false} aria-label={`Uploading ${item.name}`} />}
          <Button
            type="text"
            aria-label={`Remove ${item.name}`}
            icon={<CloseOutlined />}
            onClick={() => onRemove(item.key)}
          />
        </li>
      ))}
    </ul>
  );
}

/** The people an "@name" could mean; the arrows pick, Enter or a click chooses. */
export function MentionList({
  people,
  picked,
  onChoose,
}: {
  people: Person[];
  picked: number;
  onChoose: (person: Person) => void;
}) {
  return (
    <ul className="nx-co-mentions" role="listbox" aria-label="People to mention">
      {people.map((person, index) => (
        <li
          key={person.id}
          role="option"
          aria-selected={index === picked}
          className={index === picked ? "is-on" : undefined}
          onMouseDown={(event) => {
            event.preventDefault();
            onChoose(person);
          }}
        >
          <PersonAvatar size={22} src={person.avatar_url} initials={person.initials} />
          <span>{person.name}</span>
          {person.job_title && <span className="nx-co-muted">{person.job_title}</span>}
        </li>
      ))}
    </ul>
  );
}
