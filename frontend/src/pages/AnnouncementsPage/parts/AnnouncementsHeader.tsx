import { Button, Segmented, Space, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";

import type { AnnouncementsPageData } from "../useAnnouncementsPage";

/** The title, the reader/author switch and the write action. */
export function AnnouncementsHeader({ page }: { page: AnnouncementsPageData }) {
  const { setEditing, view, set, feed, canManage } = page;
  return (
    <PageHeader
      title="Announcements"
      subtitle="What the platform has told everybody — and, for an author, how far each notice got."
      tag={
        (feed.data?.unread ?? 0) > 0 ? (
          <Tag color="blue">{feed.data?.unread} unread</Tag>
        ) : undefined
      }
      actions={
        <Space size={8}>
          {canManage && (
            <Segmented
              aria-label="View"
              data-testid="announcement-view"
              value={view}
              onChange={(next) => set({ view: next === "manage" ? "manage" : null })}
              options={[
                { value: "read", label: "Noticeboard" },
                { value: "manage", label: "Authoring" },
              ]}
            />
          )}
          {canManage && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                set({ view: "manage" });
                setEditing("new");
              }}
              data-testid="new-announcement"
            >
              Write one
            </Button>
          )}
        </Space>
      }
    />
  );
}
