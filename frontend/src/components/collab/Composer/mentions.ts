import { type Person } from "@/api/directory";
import type { Attachment } from "@/api/comments";

export const EMOJI = [
  "😀", "😄", "😂", "🙂", "😉", "😍", "🤔", "😮", "😢", "😅", "🙏", "👍",
  "👎", "👏", "🙌", "💪", "🎉", "🚀", "🔥", "✅", "❌", "⚠️", "💡", "👀",
  "❤️", "⭐", "📌", "📎", "☕", "🍕",
];

export interface ComposerSend {
  body: string;
  mention_ids: string[];
  attachment_ids: string[];
}

export interface Pending {
  key: string;
  name: string;
  size: number;
  progress: number;
  file?: Attachment;
  error?: string;
}

/**
 * The directory matches anywhere in a name; a mention picker should offer the
 * people whose name *starts* with what was typed first — "@Mar" is Mara before
 * it is Adrian from Marketing.
 */
export function rankPeople(people: Person[], query: string): Person[] {
  const term = query.trim().toLowerCase();
  const score = (person: Person) => {
    const name = person.name.toLowerCase();
    if (!term) return 2;
    if (name.startsWith(term)) return 0;
    if (name.split(/\s+/).some((word) => term.split(/\s+/).every((part) => word.startsWith(part)))) return 1;
    return 2;
  };
  return people
    .filter((person) => !person.is_me)
    .map((person, index) => ({ person, index, rank: score(person) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.person);
}

/** The `@word` being typed just before the caret, if any. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([\w'’.-]{0,30}(?:\s[\w'’.-]{0,30})?)$/.exec(before);
  if (!match) return null;
  const query = match[2] ?? "";
  if (query.includes(" ") && !/^\S+\s\S*$/.test(query)) return null;
  return { start: before.length - query.length - 1, query };
}
