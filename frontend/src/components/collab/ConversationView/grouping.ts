import type { RecordComment } from "@/api/comments";

/** Lines this close together from one person read as one message. */
const GROUP_MS = 5 * 60_000;

export function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Whether a line continues the block above it: same person, within a few minutes, and not the first unread. */
export function continues(previous: RecordComment | undefined, item: RecordComment, firstUnread: string | null): boolean {
  return (
    !!previous &&
    previous.author.id === item.author.id &&
    new Date(item.created_at).getTime() - new Date(previous.created_at).getTime() < GROUP_MS &&
    item.id !== firstUnread
  );
}
