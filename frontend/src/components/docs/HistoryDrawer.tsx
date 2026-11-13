/**
 * A page's history (§48): every save, newest first, any of which can be read
 * and made current again. Restoring is a new save — nothing in between is lost.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { App as AntApp, Button, Drawer, Empty, Skeleton, Space, Tag, Typography } from "antd";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { docsApi, type DocPage } from "@/api/docs";
import { URL_OVERLAY } from "@/app/history";
import { absoluteTime, relativeTime } from "@/lib/time";

import { BlockView } from "./BlockView";

const { Text } = Typography;

export function HistoryDrawer({
  page,
  open,
  onClose,
  onRestored,
}: {
  page: DocPage;
  open: boolean;
  onClose: () => void;
  onRestored: (page: DocPage) => void;
}) {
  const { message } = AntApp.useApp();
  const [viewing, setViewing] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ["doc-revisions", page.id, page.version],
    queryFn: ({ signal }) => docsApi.revisions(page.id, signal),
    enabled: open,
  });
  const version = useQuery({
    queryKey: ["doc-revision", page.id, viewing],
    queryFn: ({ signal }) => docsApi.revision(page.id, viewing!, signal),
    enabled: open && Boolean(viewing),
  });
  const restore = useMutation({
    mutationFn: (id: string) => docsApi.restore(page.id, id),
    onSuccess: (restored) => {
      message.success(`Restored — now version ${restored.version}`);
      setViewing(null);
      onRestored(restored);
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : "That version was not restored."),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      title="Page history"
      rootClassName={URL_OVERLAY}
      data-testid="doc-history"
    >
      {history.isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (history.data?.items ?? []).length === 0 ? (
        <Empty description="No history yet" />
      ) : (
        <ol className="nx-dc-history">
          {history.data!.items.map((item) => (
            <li key={item.id} className={viewing === item.id ? "is-on" : undefined}>
              <div className="nx-dc-history-head">
                <strong>Version {item.version}</strong>
                {item.is_current && <Tag color="blue" bordered={false}>current</Tag>}
                <Text type="secondary" title={absoluteTime(item.created_at)}>
                  {item.author?.name ?? "Somebody"} · {relativeTime(item.created_at)}
                </Text>
              </div>
              {item.note && <Text type="secondary">{item.note}</Text>}
              <Space size={6}>
                <Button size="small" onClick={() => setViewing(viewing === item.id ? null : item.id)}>
                  {viewing === item.id ? "Hide" : "View"}
                </Button>
                {!item.is_current && page.can_edit && (
                  <Button
                    size="small"
                    type="primary"
                    loading={restore.isPending && restore.variables === item.id}
                    onClick={() => restore.mutate(item.id)}
                    data-testid={`restore-${item.version}`}
                  >
                    Restore
                  </Button>
                )}
              </Space>
              {viewing === item.id && (
                <div className="nx-dc-history-body">
                  {version.isLoading ? (
                    <Skeleton active />
                  ) : (
                    <>
                      <h3>{version.data?.title}</h3>
                      {(version.data?.blocks ?? []).map((block) => (
                        <BlockView key={block.id} block={block} tasks={page.tasks} people={{}} />
                      ))}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
}
