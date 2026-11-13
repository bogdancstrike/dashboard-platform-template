import { Input, Space, Switch, Typography } from "antd";
import { Link } from "react-router-dom";

import type { useAutomationDrawer } from "./useAutomationDrawer";

const { Text, Title } = Typography;

type Drawer = ReturnType<typeof useAutomationDrawer>;

/** The name (editable for its author), what it watches, the canvas, and on or off. */
export function AutomationHead({ drawer }: { drawer: Drawer }) {
  const { canEdit, write } = drawer;
  const detail = drawer.detail!;
  return (
    <div className="nu-automation-head">
      <Title level={5} className="nu-automation-title">
        {canEdit ? (
          <Input
            defaultValue={detail.name}
            aria-label="Name"
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== detail.name) write.mutate({ name: value });
            }}
          />
        ) : (
          detail.name
        )}
      </Title>
      <Space size={12}>
        <Text type="secondary">
          Watches{" "}
          <Link to={detail.resource_path}>{detail.resource_label.toLowerCase()}</Link>
        </Text>
        {/* The same definition, drawn as a graph (§49). */}
        <Link to={`/workflows/${detail.id}/canvas`} data-testid="open-canvas">
          Open on canvas
        </Link>
        {canEdit && (
          <Switch
            checked={detail.enabled}
            loading={write.isPending}
            aria-label="Enabled"
            onChange={(enabled) => write.mutate({ enabled })}
            data-testid="toggle-enabled"
          />
        )}
      </Space>
    </div>
  );
}
