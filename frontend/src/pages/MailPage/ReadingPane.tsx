import { Alert, Button, Card, Dropdown, Skeleton, Space, Tooltip, Typography } from "antd";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EnterOutlined,
  FolderOpenOutlined,
  MailFilled,
  MailOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import { mailApi } from "@/api/mail";
import { ApiError } from "@/api/client";
import { FOLDER_META } from "@/components/mail/FolderRail";
import { ThreadReader } from "@/components/mail/ThreadReader";
import { EmptyState } from "@/components/EmptyState";

import type { MailPageModel } from "./useMailPage";

/** The open thread: its messages, and replying, filing and binning it. */
export function ReadingPane({ m }: { m: MailPageModel }) {
  const { message, modal, setComposing, setReplyTo, setEditing, pane, openId, set, opened, refresh, star, bin, discard, listed } = m;
  const data = listed!;
  const reading = opened.data;
  const { Text } = Typography;
  return (
    <Card
      size="small"
      className="nu-pane nu-mail-reader"
      hidden={pane === "off" && !openId}
      data-testid="mail-reader"
      title={
        reading ? (
          <div className="nu-mail-readerbar">
            {/* Back to the list when there is no pane to go back *to*: with
                the reader taking the whole width, a subject with no way out
                is a page somebody reaches for the browser button on. */}
            {pane === "off" && (
              <Button
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={() => set({ thread: null })}
                data-testid="back-to-list"
              >
                All conversations
              </Button>
            )}
            <Text ellipsis>{reading.subject}</Text>
            <Space size={4}>
              {/* The two gestures a reader reaches for most, as icons with
                  their names on hover: reply is the verb of a mailbox, and
                  a star is how somebody keeps hold of a thread they have
                  finished reading but not finished with. */}
              <Tooltip title="Reply to this conversation">
                <Button
                  type="text"
                  icon={<EnterOutlined />}
                  aria-label={`Reply to ${reading.subject}`}
                  onClick={() => {
                    setReplyTo(reading);
                    setEditing(null);
                    setComposing(true);
                  }}
                  data-testid="reader-reply"
                />
              </Tooltip>
              <Tooltip title={reading.is_starred ? "Remove the star" : "Star it"}>
                <Button
                  type="text"
                  aria-label={`${reading.is_starred ? "Unstar" : "Star"} ${reading.subject}`}
                  aria-pressed={reading.is_starred}
                  icon={
                    reading.is_starred ? (
                      <StarFilled className="nu-thread-starred" />
                    ) : (
                      <StarOutlined />
                    )
                  }
                  onClick={() => star.mutate(reading)}
                  data-testid="reader-star"
                />
              </Tooltip>
              <Tooltip title={reading.unread_count > 0 ? "Mark as read" : "Mark as unread"}>
                <Button
                  type="text"
                  aria-label={
                    reading.unread_count > 0
                      ? `Mark ${reading.subject} as read`
                      : `Mark ${reading.subject} as unread`
                  }
                  icon={reading.unread_count > 0 ? <MailOutlined /> : <MailFilled />}
                  onClick={() =>
                    mailApi
                      // Unread messages in it: this press reads them. None:
                      // it marks the thread unread. (It sent the opposite,
                      // so "Mark as unread" re-marked a read thread read.)
                      .updateThread(reading.id, { is_read: reading.unread_count > 0 })
                      .then(refresh)
                      .catch(() => message.error("That change was refused."))
                  }
                  data-testid="reader-read"
                />
              </Tooltip>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: data.movable
                    .filter((item) => item !== reading.folder)
                    .map((item) => ({
                      key: item,
                      label: `Move to ${FOLDER_META[item].label}`,
                      onClick: () =>
                        mailApi
                          .updateThread(reading.id, { folder: item })
                          .then(refresh)
                          .catch(() => message.error("That move was refused.")),
                    })),
                }}
              >
                <Button icon={<FolderOpenOutlined />} data-testid="move-thread">
                  Move
                </Button>
              </Dropdown>
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={bin.isPending}
                onClick={() =>
                  reading.folder === "TRASH"
                    ? modal.confirm({
                        title: `Delete ${reading.subject} for good?`,
                        content:
                          "It is already in the bin. This removes it from the database.",
                        okText: "Delete",
                        okButtonProps: { danger: true },
                        onOk: () => bin.mutateAsync(reading),
                      })
                    : bin.mutate(reading)
                }
                data-testid="bin-thread"
              >
                {reading.folder === "TRASH" ? "Delete" : "Bin"}
              </Button>
            </Space>
          </div>
        ) : undefined
      }
    >
      {!openId ? (
        <EmptyState compact title="Choose a conversation to read it" />
      ) : opened.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : opened.isError ? (
        <Alert
          type="error"
          showIcon
          message={
            opened.error instanceof ApiError
              ? opened.error.message
              : "That conversation could not be opened."
          }
        />
      ) : reading ? (
        <ThreadReader
          thread={reading}
          onReply={() => {
            setReplyTo(reading);
            setEditing(null);
            setComposing(true);
          }}
          onEditDraft={(draft) => {
            setEditing(draft);
            setReplyTo(null);
            setComposing(true);
          }}
          onDiscardDraft={(draft) =>
            modal.confirm({
              title: "Discard this draft?",
              content: "It has not been sent, and nothing keeps a copy.",
              okText: "Discard",
              okButtonProps: { danger: true },
              onOk: () => discard.mutateAsync(draft),
            })
          }
        />
      ) : null}
    </Card>
  );
}
