/**
 * `/mail` — a mailbox (§14–§16, §20).
 *
 * Four decisions worth stating.
 *
 * **Three panes, and the page never scrolls.** Folders, conversations, and the
 * one being read. Each pane scrolls inside itself, which is what makes a
 * mailbox usable: a document-level scrollbar means losing the folder rail the
 * moment you read anything. Below the breakpoint the reader takes the whole
 * width and the list becomes the previous screen, because three columns in 360
 * pixels is three unusable ones.
 *
 * **The folder, the search and the open thread are all in the address.**
 * `?folder=ARCHIVE&q=invoice&thread=…` is a link somebody can send and a state
 * the back button steps through (§69).
 *
 * **The bulk bar appears when something is selected and says how many.** A
 * toolbar of permanently-disabled buttons teaches nobody what they do; one
 * that arrives with "3 selected" on it is self-explanatory.
 *
 * **Every count on the page is the server's.** The folder rail's unread
 * numbers, the thread's message count, the snippet — all recomputed from rows
 * when anything changes. A badge this page decremented would drift, and a
 * wrong unread count is the single most irritating bug a mail client has.
 *
 * **Where the reading pane sits is the reader's** (§40). Beside the list,
 * under it, or nowhere — and "nowhere" is a real mailbox, not a degraded one:
 * some people triage a full-width list and open one thing at a time. The
 * preference is stored against the account rather than in this browser, so it
 * travels; the layout is a class on one element, because three panes and two
 * panes are the same three components in a different grid.
 */

import { Alert, Button, Card, Input, Skeleton, Space, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { ApiError } from "@/api/client";
import { Composer } from "@/components/mail/Composer";
import { FOLDER_META, FolderRail } from "@/components/mail/FolderRail";
import { PageHeader } from "@/components/PageHeader";

import { MailList } from "./MailList";
import { ReadingPane } from "./ReadingPane";
import { useMailPage } from "./useMailPage";

const { Text } = Typography;

export default function MailPage() {
  const m = useMailPage();
  const { term, setTerm, composing, setComposing, replyTo, setReplyTo, editing, setEditing, pane, folder, label, set, meEmail, list, listed, refresh } = m;

  if (list.isLoading) return <Skeleton active paragraph={{ rows: 12 }} />;

  if (list.isError) {
    return (
      <>
        <PageHeader title="Mail" />
        <Alert
          type="error"
          showIcon
          message={
            list.error instanceof ApiError
              ? list.error.message
              : "The mailbox could not be loaded."
          }
          action={
            <Button onClick={() => void list.refetch()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  const data = listed!;
  const inbox = data.folders.find((entry) => entry.key === "INBOX");

  return (
    <>
      <PageHeader
        title="Mail"
        subtitle="Conversations, drafts and everything the platform has written on your behalf."
        tag={
          inbox && inbox.unread > 0 ? (
            <Text type="secondary">{inbox.unread} unread in the inbox</Text>
          ) : undefined
        }
        actions={
          <Space size={8}>
            <Input.Search
              allowClear
              placeholder={`Search ${FOLDER_META[folder].label.toLowerCase()}`}
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                set({ q: event.target.value || null, page: null });
              }}
              style={{ width: 240 }}
              aria-label="Search this folder"
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setReplyTo(null);
                setEditing(null);
                setComposing(true);
              }}
              data-testid="compose"
            >
              Write one
            </Button>
          </Space>
        }
      />

      <div className={`nu-fill nu-mail nu-mail--${pane}`}>
        <Card size="small" className="nu-pane nu-mail-rail" data-testid="mail-rail">
          <FolderRail
            data={data}
            folder={folder}
            label={label}
            onFolder={(next) =>
              set({ folder: next, thread: null, label: null, page: null })
            }
            onLabel={(next) => set({ label: next, page: null })}
          />
        </Card>

        {/* With no reading pane, the list steps aside while something is open
            — which is what "off" means on a phone-shaped mailbox and what it
            should mean on a wide one too. */}
        <MailList m={m} />

        <ReadingPane m={m} />
      </div>

      <Composer
        open={composing}
        thread={replyTo}
        draft={editing}
        meEmail={meEmail}
        priorities={data.priorities}
        onClose={() => {
          setComposing(false);
          setReplyTo(null);
          setEditing(null);
        }}
        onSaved={(saved) => {
          setComposing(false);
          setReplyTo(null);
          setEditing(null);
          // Straight to what was just written, in the folder it landed in —
          // otherwise a reply vanishes from the list it was sent from and
          // reads as having failed.
          set({ folder: saved.folder, thread: saved.id, page: null });
          refresh();
        }}
      />
    </>
  );
}
