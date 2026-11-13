import { useQuery } from "@tanstack/react-query";
import { List, Space, Tooltip, Typography } from "antd";
import { PaperClipOutlined, StarFilled } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { mailApi } from "@/api/mail";
import { PersonAvatar } from "@/components/PersonAvatar";
import { absoluteTime, relativeTime } from "@/lib/time";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { Loading, MoreLink, Nothing, ROWS, type ModuleBodyProps } from "./shared";

const { Text } = Typography;

/**
 * What is waiting in the inbox.
 *
 * The sender and the subject, and the unread ones in a heavier weight — which
 * is the whole scan somebody does on a mail list. The snippet is dropped: at
 * widget width it wraps to three lines and pushes the next thread off the
 * card, and a subject a person recognises is worth more than the first eight
 * words of a body they do not.
 */
export function MailBody({ widget, fallback }: ModuleBodyProps) {
  const folder = widget.config.folder || "INBOX";
  const params = {
    folder,
    ...(widget.config.unread_only ? { unread: "true" } : {}),
  };

  const list = useQuery({
    queryKey: queryKeys.mailThreads(params),
    queryFn: ({ signal }) => mailApi.threads(params, signal),
    staleTime: STALE.short,
  });

  if (list.isLoading) return <Loading />;
  if (list.isError) return fallback(list.error, "mail");

  const items = (list.data?.items ?? []).slice(0, ROWS);
  const unread = list.data?.folders.find((entry) => entry.key === folder)?.unread ?? 0;

  if (items.length === 0) {
    return <Nothing what={widget.config.unread_only ? "Nothing unread" : "Nothing in this folder"} />;
  }

  return (
    <>
      <List
        size="small"
        dataSource={items}
        renderItem={(thread) => {
          const who = thread.participants[0];
          return (
            <List.Item className={thread.unread_count > 0 ? "is-unread" : undefined}>
              <Link to={`/mail?thread=${thread.id}`} className="nu-widget-mail">
                <PersonAvatar name={who?.name ?? who?.email ?? "?"} size={22} />
                <span className="nu-widget-mail-body">
                  <Text ellipsis strong={thread.unread_count > 0} className="nu-widget-mail-subject">
                    {thread.subject || "(no subject)"}
                  </Text>
                  <Text type="secondary" ellipsis className="nu-widget-dim">
                    {who?.name ?? who?.email ?? "Unknown sender"}
                    {thread.message_count > 1 ? ` · ${thread.message_count}` : ""}
                  </Text>
                </span>
                <Space size={4} className="nu-widget-mail-marks">
                  {thread.is_starred && <StarFilled className="nu-widget-star" aria-label="Starred" />}
                  {thread.has_attachments && <PaperClipOutlined aria-label="Has an attachment" />}
                  {thread.last_message_at && (
                    <Tooltip title={absoluteTime(thread.last_message_at)}>
                      <Text type="secondary" className="nu-widget-dim">
                        {relativeTime(thread.last_message_at)}
                      </Text>
                    </Tooltip>
                  )}
                </Space>
              </Link>
            </List.Item>
          );
        }}
      />
      <MoreLink to={`/mail?folder=${folder}`}>
        {unread > 0 ? `${unread} unread in ${folder.toLowerCase()}` : `Open ${folder.toLowerCase()}`}
      </MoreLink>
    </>
  );
}
