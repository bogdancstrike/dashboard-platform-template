import { type MailFolder } from "@/api/mail";

/** The address keys that are places rather than adjustments (§history). */
export const PLACES = new Set(["thread", "folder", "label"]);

export const FOLDERS: MailFolder[] = [
  "INBOX",
  "OUTBOX",
  "SENT",
  "DRAFTS",
  "ARCHIVE",
  "SPAM",
  "TRASH",
];

export function asFolder(raw: string | null): MailFolder {
  return FOLDERS.includes(raw as MailFolder) ? (raw as MailFolder) : "INBOX";
}
