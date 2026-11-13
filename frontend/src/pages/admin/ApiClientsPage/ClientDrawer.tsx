import { Alert, Button, Drawer, Popconfirm, Skeleton } from "antd";
import { DeleteOutlined } from "@ant-design/icons";

import { URL_OVERLAY } from "@/app/history";
import { apiMessage } from "@/lib/errors";

import { ClientDetail } from "./ClientDetail";
import type { useApiClientsPage } from "./useApiClientsPage";

/** One client in the drawer the address opens, with its retirement. */
export function ClientDrawer({ page, grace }: { page: ReturnType<typeof useApiClientsPage>; grace: number }) {
  const { overlay, detail, remove, rotate, revoke } = page;
  const client = detail.data;
  return (
    <Drawer
      className="nx-ad-drawer"
      open={overlay.value !== null}
      rootClassName={URL_OVERLAY}
      onClose={overlay.close}
      width={700}
      title={client?.name ?? "Client"}
      destroyOnClose
      extra={
        client && (
          <Popconfirm
            title={`Retire ${client.name}?`}
            description={
              client.live_credentials > 0
                ? `Its ${client.live_credentials} live ${client.live_credentials === 1 ? "key" : "keys"} are revoked with it. Anything using them fails immediately.`
                : "It has no live keys, so nothing stops working."
            }
            okText="Retire it"
            okButtonProps={{ danger: true }}
            onConfirm={() => remove.mutate(client.id)}
          >
            <Button danger icon={<DeleteOutlined />} loading={remove.isPending} data-testid="retire-client">
              Retire
            </Button>
          </Popconfirm>
        )
      }
    >
      {detail.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}
      {detail.isError && <Alert type="error" showIcon message={apiMessage(detail.error, "That client could not be read.")} />}
      {client && (
        <ClientDetail
          client={client}
          grace={grace}
          busy={rotate.isPending || revoke.isPending}
          onRotate={(credentialId) => rotate.mutate({ id: client.id, credentialId })}
          onRevoke={(credentialId) => revoke.mutate(credentialId)}
        />
      )}
    </Drawer>
  );
}
