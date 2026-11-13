import { App as AntApp, Button, Space, Tooltip } from "antd";
import { PlayCircleOutlined, ThunderboltOutlined } from "@ant-design/icons";

import type { useAutomationDrawer } from "./useAutomationDrawer";

type Drawer = ReturnType<typeof useAutomationDrawer>;

/**
 * Dry run, always available — reading what a rule would do is how somebody
 * decides whether to switch it on — and running it for real behind it.
 */
export function DrawerActions({ drawer }: { drawer: Drawer }) {
  const { modal } = AntApp.useApp();
  const { evaluate, canEdit } = drawer;
  const detail = drawer.detail!;
  return (
    <Space size={8}>
      <Button
        icon={<PlayCircleOutlined />}
        loading={evaluate.isPending}
        onClick={() => evaluate.mutate(true)}
        data-testid="dry-run"
      >
        Dry run
      </Button>
      {canEdit && (
        <Tooltip
          title={
            detail.enabled
              ? "Runs the actions for real, on everything not in cooldown."
              : "Enable it first — a paused automation does not fire."
          }
        >
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            disabled={!detail.enabled}
            loading={evaluate.isPending}
            onClick={() =>
              modal.confirm({
                title: "Run it for real?",
                content:
                  "Its actions will run on every matching record that is not in cooldown — notifications sent, tasks raised, webhooks called.",
                okText: "Run it",
                onOk: () => evaluate.mutateAsync(false),
              })
            }
            data-testid="run-for-real"
          >
            Run now
          </Button>
        </Tooltip>
      )}
    </Space>
  );
}
