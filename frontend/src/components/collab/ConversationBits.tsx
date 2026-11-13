/**
 * The small furniture of a conversation (§47): who has seen it, who is
 * typing, where a day begins, and where the unread part starts.
 */

import { Avatar, Tooltip } from "antd";

import type { ReadMarker } from "@/api/comments";
import { PersonAvatar } from "@/components/PersonAvatar";
import { absoluteTime } from "@/lib/time";

import { initials } from "./MessageItem";

/** "Seen by" under the newest line: everybody whose marker is past it. */
export function SeenBy({ reads, after, me }: { reads: ReadMarker[]; after: string; me?: string }) {
  const seen = reads.filter((read) => read.user_id !== me && read.last_read_at >= after);
  if (seen.length === 0) return null;
  const names = seen.map((read) => read.name);
  const label =
    names.length <= 3 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
  return (
    <div className="nx-co-seen" data-testid="seen-by">
      <Avatar.Group size={18} max={{ count: 4 }}>
        {seen.map((read) => (
          <Tooltip key={read.user_id} title={`${read.name} · ${absoluteTime(read.last_read_at)}`}>
            <PersonAvatar size={18} src={read.avatar_url} initials={initials(read.name)} />
          </Tooltip>
        ))}
      </Avatar.Group>
      <span>Seen by {label}</span>
    </div>
  );
}

/** "Mara is typing…", "Mara and Otto are typing…". */
export function typingText(names: string[]): string {
  if (names.length === 0) return "";
  const first = names.map((name) => name.split(" ")[0] ?? name);
  if (first.length === 1) return `${first[0]} is typing…`;
  if (first.length === 2) return `${first[0]} and ${first[1]} are typing…`;
  return `${first[0]} and ${first.length - 1} others are typing…`;
}

export function TypingLine({ names }: { names: string[] }) {
  return (
    <div className="nx-co-typing" aria-live="polite" data-testid="typing">
      {names.length > 0 && (
        <>
          <span className="nx-co-typing-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          {typingText(names)}
        </>
      )}
    </div>
  );
}

export function dayLabel(iso: string, today = new Date()): string {
  const date = new Date(iso);
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((start(today) - start(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="nx-co-day" role="separator">
      <span>{dayLabel(iso)}</span>
    </div>
  );
}

export function NewDivider() {
  return (
    <div className="nx-co-new" role="separator" data-testid="new-divider">
      <span>New</span>
    </div>
  );
}
