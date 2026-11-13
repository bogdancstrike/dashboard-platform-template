import { Alert, Button, Space, Typography } from "antd";

import { ApiError } from "@/api/client";
import { NotificationDigest } from "@/components/notifications/NotificationDigest";

import { NotificationFilters } from "./parts/NotificationFilters";
import { NotificationList } from "./parts/NotificationList";
import { NotificationsHeader } from "./parts/NotificationsHeader";
import { useNotificationsPage } from "./useNotificationsPage";

const { Text } = Typography;

export default function NotificationsPage() {
  const view = useNotificationsPage();
  const { listing, set, activeTile } = view;

  return (
    <>
      <NotificationsHeader view={view} />

      <NotificationDigest
        counts={listing.data}
        active={activeTile}
        onFilter={(filter) => set({ ...filter, group_key: null, page: null }, false)}
      />

      <NotificationFilters view={view} />

      {listing.isError && (
        <Alert
          type="error"
          showIcon
          className="nu-block"
          message={
            listing.error instanceof ApiError
              ? listing.error.message
              : "Could not load your notifications"
          }
          description={
            listing.error instanceof ApiError ? (
              <Space direction="vertical" size={4}>
                <Text type="secondary">
                  {listing.error.status} {listing.error.code}
                </Text>
                <Text code copyable={{ text: listing.error.correlationId }}>
                  {listing.error.correlationId}
                </Text>
              </Space>
            ) : undefined
          }
          action={<Button onClick={() => void listing.refetch()}>Retry</Button>}
        />
      )}

      <NotificationList view={view} />
    </>
  );
}
