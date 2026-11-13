import { Button, Card, Pagination, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import { CheckOutlined, DeleteOutlined, UndoOutlined } from "@ant-design/icons";

import { EmptyState, NoResults } from "@/components/EmptyState";
import { categoryIcon, humanise, severityColor } from "@/components/notifications/presentation";
import { absoluteTime, relativeTime } from "@/lib/time";
import { confirmDelete } from "@/lib/confirm";

import { severityTag } from "../model";
const { Text } = Typography;

import type { NotificationsPageData } from "../useNotificationsPage";

/** The notifications themselves, or why there are none, with paging. */
export function NotificationList({ view }: { view: NotificationsPageData }) {
  const {
    modal,
    grouped,
    page,
    pageSize,
    listing,
    setRead,
    remove,
    markAll,
    set,
    filterCount,
    clearFilters,
    items,
    total,
    days,
    openItem,
  } = view;
  return (
    <Card size="small" className="nu-block nx-ov-feed nx-ov-notices">
      {listing.isLoading ? (
        // A skeleton in the final layout, so the rows do not jump when they
        // arrive under the reader's cursor.
        <Skeleton active title={false} paragraph={{ rows: 8 }} />
      ) : items.length === 0 ? (
        filterCount > 0 ? (
          <NoResults filterCount={filterCount} onClear={clearFilters} />
        ) : (
          <EmptyState
            title="Nothing has needed your attention yet"
            hint="Mentions, assignments, approvals and security notices arrive here as they happen."
          />
        )
      ) : (
        <div className="nu-notice-days">
          {days.map((day) => (
            <section key={day.label} aria-label={day.label}>
              <h3 className="nu-notice-day">
                <span>{day.label}</span>
                <span className="nu-notice-day-count">{day.items.length}</span>
              </h3>
              <ul className="nu-notice-list" aria-label="Notifications" aria-live="polite">
                {day.items.map((item) => (
                  <li key={item.id}>
                    <article
                      className={`nu-notice${item.is_read ? "" : " nu-notice--unread"}`}
                      data-testid="notification-row"
                    >
                      {/* The severity is the tint and the category is the
                          glyph: two channels, so a reader who cannot
                          separate the colours still reads the kind. */}
                      <span
                        className="nu-notice-icon"
                        style={{
                          color: severityColor(item.severity),
                          background: `color-mix(in srgb, ${severityColor(item.severity)} 14%, transparent)`,
                        }}
                        aria-hidden
                      >
                        {categoryIcon(item.category)}
                      </span>

                      <div className="nu-notice-body">
                        <div className="nu-notice-title">
                          <button
                            type="button"
                            className="nu-notice-open"
                            onClick={() => openItem(item)}
                          >
                            <Text strong={!item.is_read}>{item.title}</Text>
                          </button>
                          {item.severity !== "INFO" && (
                            <Tag color={severityTag(item.severity)} bordered={false}>
                              {humanise(item.severity)}
                            </Tag>
                          )}
                          {grouped && (item.group_count ?? 1) > 1 && (
                            <Tooltip title={`${item.group_count} similar notifications`}>
                              <Tag
                                data-testid="group-count"
                                bordered={false}
                                onClick={() =>
                                  set({ group: null, group_key: item.group_key, page: null })
                                }
                                style={{ cursor: "pointer" }}
                              >
                                +{(item.group_count ?? 1) - 1} more
                              </Tag>
                            </Tooltip>
                          )}
                        </div>

                        {item.body && <p className="nu-notice-text">{item.body}</p>}

                        {/* The kind on the left, when it arrived on the
                            right. A row whose every fact huddles at the
                            left edge leaves the other half of a wide page
                            blank — and the time is what a reader scans a
                            list of notifications *by*, so the right edge is
                            where it belongs. */}
                        <div className="nu-notice-meta">
                          <span className="nu-notice-meta-kind">
                            <span className="nu-notice-chip">{humanise(item.category)}</span>
                            {item.actor_label && <span>{item.actor_label}</span>}
                            {item.link && <span className="nu-notice-link">Opens the record</span>}
                          </span>
                          <span title={absoluteTime(item.created_at)}>
                            {relativeTime(item.created_at)}
                          </span>
                        </div>
                      </div>

                      <Space size={2} className="nu-notice-actions">
                        {grouped && (item.group_count ?? 1) > 1 && item.group_key ? (
                          <Tooltip title="Mark this group read">
                            <Button
                              type="text"
                              icon={<CheckOutlined />}
                              aria-label={`Mark the ${item.title} group read`}
                              onClick={() =>
                                markAll.mutate({ group_key: item.group_key ?? undefined })
                              }
                            />
                          </Tooltip>
                        ) : (
                          <Tooltip title={item.is_read ? "Mark unread" : "Mark read"}>
                            <Button
                              type="text"
                              icon={item.is_read ? <UndoOutlined /> : <CheckOutlined />}
                              aria-label={`Mark ${item.title} as ${item.is_read ? "unread" : "read"}`}
                              onClick={() => setRead.mutate({ id: item.id, isRead: !item.is_read })}
                            />
                          </Tooltip>
                        )}
                        <Tooltip title="Delete">
                          <Button
                            type="text"
                            icon={<DeleteOutlined />}
                            aria-label={`Delete ${item.title}`}
                            onClick={() =>
                              confirmDelete(modal, {
                                what: item.title,
                                consequence:
                                  "It goes from the notification centre for good. Whatever it was telling you about is unaffected.",
                                onOk: () => remove.mutateAsync(item.id),
                              })
                            }
                          />
                        </Tooltip>
                      </Space>
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {total > pageSize && (
        <div className="nu-notice-pager">
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger
            pageSizeOptions={[10, 25, 50, 100]}
            showTotal={(count, range) =>
              `${range[0]}–${range[1]} of ${count.toLocaleString()}${grouped ? " groups" : ""}`
            }
            onChange={(next, size) =>
              set({ page: next === 1 ? null : next, page_size: size === 25 ? null : size })
            }
          />
        </div>
      )}
    </Card>
  );
}
