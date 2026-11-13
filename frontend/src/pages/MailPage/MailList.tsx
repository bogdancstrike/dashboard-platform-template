import { Button, Card, Dropdown, Pagination, Segmented, Space, Typography } from "antd";
import { FolderOpenOutlined, MailFilled, MailOutlined, TagOutlined } from "@ant-design/icons";
import { FOLDER_META } from "@/components/mail/FolderRail";
import { ThreadList } from "@/components/mail/ThreadList";
import { EmptyState } from "@/components/EmptyState";

import type { MailPageModel } from "./useMailPage";

/** The list: search, bulk actions over the ticked threads, the threads, the pager. */
export function MailList({ m }: { m: MailPageModel }) {
  const { selected, setSelected, pane, folder, openId, only, debounced, set, meEmail, star, act, listed } = m;
  const data = listed!;
  const { Text } = Typography;
  return (
    <Card
      size="small"
      className="nu-pane nu-mail-list"
      hidden={pane === "off" && Boolean(openId)}
      data-testid="mail-list"
      title={
        <div className="nu-mail-listbar">
          <Segmented
            size="small"
            aria-label="Show"
            value={only || "all"}
            onChange={(next) =>
              set({ only: next === "all" ? null : String(next), page: null })
            }
            options={[
              { value: "all", label: `All (${data.total})` },
              { value: "unread", label: "Unread" },
              { value: "starred", label: "Starred" },
            ]}
          />
          {/* Arrives when something is selected, with the count on it. A
              toolbar of permanently-disabled buttons teaches nobody. */}
          {selected.length > 0 && (
            <Space size={4} data-testid="bulk-bar">
              <Text type="secondary">{selected.length} selected</Text>
              <Button
                icon={<MailOutlined />}
                loading={act.isPending}
                onClick={() => act.mutate({ action: "READ" })}
                data-testid="bulk-read"
              >
                Read
              </Button>
              {/* Both directions, because "I have read this and want to
                  come back to it" is half of what the flag is for — and a
                  mailbox that can only mark read is one where that
                  intention has nowhere to go. */}
              <Button
                icon={<MailFilled />}
                loading={act.isPending}
                onClick={() => act.mutate({ action: "UNREAD" })}
                data-testid="bulk-unread"
              >
                Unread
              </Button>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: data.movable
                    .filter((item) => item !== folder)
                    .map((item) => ({
                      key: item,
                      label: `Move to ${FOLDER_META[item].label}`,
                      onClick: () => act.mutate({ action: "MOVE", folder: item }),
                    })),
                }}
              >
                <Button icon={<FolderOpenOutlined />} data-testid="bulk-move">
                  Move
                </Button>
              </Dropdown>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items:
                    data.labels.length > 0
                      ? data.labels.map((item) => ({
                          key: item.key,
                          label: `Label ${item.key}`,
                          onClick: () =>
                            act.mutate({ action: "LABEL", label: item.key }),
                        }))
                      : [{ key: "none", label: "No labels in use yet", disabled: true }],
                }}
              >
                <Button icon={<TagOutlined />} data-testid="bulk-label">
                  Label
                </Button>
              </Dropdown>
              <Button onClick={() => setSelected([])}>
                Clear
              </Button>
            </Space>
          )}
        </div>
      }
    >
      {data.items.length === 0 ? (
        <EmptyState compact title={
            debounced
              ? `Nothing in ${FOLDER_META[folder].label.toLowerCase()} matches “${debounced}”`
              : `${FOLDER_META[folder].label} is empty`
          } />
      ) : (
        <>
          <ThreadList
            items={data.items}
            openId={openId}
            selected={selected}
            meEmail={meEmail}
            onOpen={(thread) => set({ thread: thread.id })}
            onSelect={setSelected}
            onStar={(thread) => star.mutate(thread)}
          />
          {data.pages > 1 && (
            <Pagination
              className="nu-mail-pages"
              simple
              current={data.page}
              pageSize={data.page_size}
              total={data.total}
              onChange={(next) => set({ page: String(next) })}
            />
          )}
        </>
      )}
    </Card>
  );
}
