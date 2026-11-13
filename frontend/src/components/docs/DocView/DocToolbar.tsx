import { Breadcrumb, Button, Space, Tooltip, Typography } from "antd";
import { DeleteOutlined, EditOutlined, HistoryOutlined, RobotOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import type { DocViewModel } from "./useDocView";

const { Text } = Typography;

/** Where the page sits, whether it is saved, and edit, history, summarise and delete. */
export function DocToolbar({ m }: { m: DocViewModel }) {
  const { modal, history, editing, save, summariesOn, summarise, remove, setEditing, conflict, dirty } = m;
  const data = m.data!;
  const status = conflict
    ? null
    : save.isPending
      ? "Saving…"
      : dirty
        ? "Unsaved changes"
        : `Saved · v${data.version}`;
  return (
    <div className="nx-dc-topbar">
      <Breadcrumb
        className="nx-dc-crumbs"
        items={[
          { title: <Link to={`/docs?space=${data.space.id}`}>{`${data.space.icon ?? ""} ${data.space.name}`.trim()}</Link> },
          ...data.breadcrumbs.map((crumb) => ({ title: <Link to={`/docs/${crumb.id}`}>{crumb.title}</Link> })),
        ]}
      />
      <Space wrap size={6} className="nx-dc-toolbar">
        {status && <Text type="secondary" className="nx-dc-status" data-testid="save-status">{status}</Text>}
        {data.can_edit && (
          <Button
            type={editing ? "primary" : "default"}
            icon={editing ? undefined : <EditOutlined />}
            onClick={() => setEditing(!editing)}
            data-testid="toggle-edit"
          >
            {editing ? "Done" : "Edit"}
          </Button>
        )}
        <Tooltip title="History">
          <Button icon={<HistoryOutlined />} aria-label="History" onClick={() => history.open("1")} data-testid="open-history" />
        </Tooltip>
        {summariesOn && (
          <Tooltip title="Summarise with AI">
            <Button icon={<RobotOutlined />} aria-label="Summarise" loading={summarise.isPending} onClick={() => summarise.mutate()} />
          </Tooltip>
        )}
        {data.can_edit && (
          <Tooltip title="Delete page">
            <Button
              danger
              icon={<DeleteOutlined />}
              aria-label="Delete page"
              onClick={() =>
                modal.confirm({
                  title: `Delete ${data.title}?`,
                  content: "The page and every page under it leave the wiki. Their history is kept.",
                  okText: "Delete",
                  okButtonProps: { danger: true, "data-testid": "confirm-delete" },
                  cancelText: "Keep it",
                  onOk: () => remove.mutateAsync(),
                })
              }
            />
          </Tooltip>
        )}
      </Space>
    </div>
  );
}
