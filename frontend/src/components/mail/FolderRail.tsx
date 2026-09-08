/**
 * The mailbox's folders and labels (§14, §20).
 *
 * Three decisions worth stating.
 *
 * **Every folder is listed, including the empty ones.** An empty Drafts is
 * information, and a rail that hides folders until they fill teaches nobody
 * where anything goes. The order is the server's declared vocabulary, so the
 * rail does not reorder itself as mail arrives.
 *
 * **The unread count is the badge; the total is not.** A folder with 400 read
 * threads needs nothing from anybody. Showing both numbers on every row is how
 * a sidebar becomes noise, and then the one number that matters is invisible.
 *
 * **Labels sit under the folders and count within the current one**, because
 * that is the folder the filter will search. A mailbox-wide count beside a
 * folder-scoped filter promises rows the click cannot find — which is worse
 * than no count, because the reader concludes the filter is broken.
 */

import { Badge, Typography } from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  FolderOutlined,
  InboxOutlined,
  SendOutlined,
  StopOutlined,
  TagOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

import type { MailFolder, MailList } from "@/api/mail";

const { Text } = Typography;

/** What each folder is called and what it looks like, in one place. */
export const FOLDER_META: Record<MailFolder, { label: string; icon: ReactNode; hint?: string }> = {
  INBOX: { label: "Inbox", icon: <InboxOutlined /> },
  OUTBOX: {
    label: "Outbox",
    icon: <SendOutlined />,
    // The honest folder, and the tooltip says why it exists.
    hint: "Written, and waiting for a transport. This template has none — sending puts a message here rather than claiming it was delivered.",
  },
  SENT: { label: "Sent", icon: <SendOutlined /> },
  DRAFTS: { label: "Drafts", icon: <EditOutlined /> },
  ARCHIVE: { label: "Archive", icon: <FolderOutlined /> },
  SPAM: { label: "Spam", icon: <StopOutlined /> },
  TRASH: { label: "Bin", icon: <DeleteOutlined /> },
};

export function FolderRail({
  data,
  folder,
  label,
  onFolder,
  onLabel,
}: {
  data: MailList;
  folder: MailFolder;
  label: string;
  onFolder: (next: MailFolder) => void;
  onLabel: (next: string | null) => void;
}) {
  return (
    <nav className="nu-mailrail" aria-label="Folders" data-testid="mail-folders">
      {data.folders.map((entry) => {
        const meta = FOLDER_META[entry.key];
        const active = entry.key === folder;
        return (
          <button
            key={entry.key}
            type="button"
            className={`nu-mailrail-row${active ? " nu-mailrail-row--active" : ""}`}
            aria-current={active ? "page" : undefined}
            // The name is on the button and not only in the visible text:
            // below 1280px the rail collapses to icons and hides that text,
            // which left every folder button with no accessible name at all —
            // 71 axe violations from one `display: none`. It also carries the
            // count, so a screen reader hears "Inbox, 3 unread".
            aria-label={
              entry.unread > 0
                ? `${meta.label}, ${entry.unread} unread`
                : `${meta.label}, ${entry.total} ${entry.total === 1 ? "conversation" : "conversations"}`
            }
            title={meta.hint}
            onClick={() => onFolder(entry.key)}
            data-testid={`folder-${entry.key}`}
          >
            <span className="nu-mailrail-icon" aria-hidden="true">
              {meta.icon}
            </span>
            <span className="nu-mailrail-label">{meta.label}</span>
            {/* The unread count, and only that. A folder of 400 read threads
                needs nothing from anybody. */}
            {entry.unread > 0 ? (
              // The count is in the button's own label above, so this is
              // decoration: labelling it again makes a screen reader read
              // the number twice.
              <Badge count={entry.unread} overflowCount={999} aria-hidden="true" />
            ) : (
              <Text type="secondary" className="nu-mailrail-total">
                {entry.total || ""}
              </Text>
            )}
          </button>
        );
      })}

      {data.labels.length > 0 && (
        <>
          <Text type="secondary" className="nu-mailrail-heading">
            Labels in {FOLDER_META[folder].label.toLowerCase()}
          </Text>
          {data.labels.map((entry) => {
            const active = entry.key === label;
            return (
              <button
                key={entry.key}
                type="button"
                className={`nu-mailrail-row${active ? " nu-mailrail-row--active" : ""}`}
                aria-pressed={active}
                aria-label={`${entry.key}, ${entry.count}`}
                onClick={() => onLabel(active ? null : entry.key)}
                data-testid={`label-${entry.key}`}
              >
                <span className="nu-mailrail-icon" aria-hidden="true">
                  <TagOutlined />
                </span>
                <span className="nu-mailrail-label">{entry.key}</span>
                <Text type="secondary" className="nu-mailrail-total">
                  {entry.count}
                </Text>
              </button>
            );
          })}
        </>
      )}
    </nav>
  );
}
