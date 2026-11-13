/**
 * An automation, opened (§49, §51).
 *
 * A drawer rather than a route, for the reason the kanban card is one: a rule
 * is read *against the others*. "Is something else already watching this?" is
 * half of why it was opened, and a page would take the list off screen.
 *
 * Three decisions worth stating.
 *
 * **Dry run is the primary action, and it is always available.** Including on
 * a paused rule, because reading what it *would* do is how somebody decides
 * whether to switch it on — and refusing that is refusing the only safe way to
 * find out. Firing for real sits behind it and says what it will do.
 *
 * **The condition is edited, and the compiled text is shown beside it.** The
 * text comes from the server, rendered by the same module that compiles the
 * tree, so the sentence a reader checks against is provably the shape of the
 * SQL that will run (§51). A rendering computed in the browser would be a
 * second opinion.
 *
 * **What it is holding back is on the page, not inferred.** A rule that has
 * gone quiet is the commonest support question an automation feature has, and
 * the answer — these nine records, until this time — is a fact the server
 * derives from the ledger and the current cooldown.
 */

import { App as AntApp, Alert, Button, Drawer, Segmented, Skeleton, Space, Tag, Typography } from "antd";
import { DeleteOutlined } from "@ant-design/icons";

import type { AutomationCatalogue } from "@/api/automations";
import { URL_OVERLAY } from "@/app/history";
import { AuditTimeline } from "@/components/audit/AuditTimeline";

import { AutomationHead } from "./AutomationHead";
import { AutomationSettings } from "./AutomationSettings";
import { DrawerActions } from "./DrawerActions";
import { SECTIONS } from "./sections";
import { useAutomationDrawer } from "./useAutomationDrawer";

const { Text } = Typography;

export function AutomationDrawer({
  ruleId,
  catalogue,
  onClose,
  onChanged,
}: {
  ruleId: string | null;
  catalogue: AutomationCatalogue;
  onClose: () => void;
  /** The list behind the drawer has to hear about every write. */
  onChanged: () => void;
}) {
  const { modal } = AntApp.useApp();
  const drawer = useAutomationDrawer(ruleId, onChanged, onClose);
  const { tab, setTab, rule, detail, canEdit, remove } = drawer;
  const Section = SECTIONS[tab];

  return (
    <Drawer
      // Its state is in the address (pushed), so the router owns back for it.
      rootClassName={URL_OVERLAY}
      open={ruleId !== null}
      width={760}
      onClose={onClose}
      title={
        detail ? (
          <Space size={8}>
            <Tag color={detail.enabled ? "success" : undefined} bordered={false}>
              {detail.enabled ? "Live" : "Paused"}
            </Tag>
            <Text>{detail.name}</Text>
          </Space>
        ) : (
          "Automation"
        )
      }
      extra={detail && <DrawerActions drawer={drawer} />}
    >
      {rule.isLoading || !detail ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : (
        <Space direction="vertical" size={16} className="nu-block">
          <AutomationHead drawer={drawer} />

          {detail.linear === false && (
            <Alert
              type="info"
              showIcon
              data-testid="drawer-canvas-only"
              message="This workflow branches, waits or asks for approval"
              description="The form shows its first condition and its actions; change its shape on the canvas."
            />
          )}

          <AutomationSettings drawer={drawer} catalogue={catalogue} />

          <Segmented
            aria-label="Section"
            value={tab}
            onChange={(next) => setTab(String(next))}
            options={[
              { value: "condition", label: "When" },
              { value: "actions", label: `Then (${detail.actions.length})` },
              { value: "runs", label: "Runs" },
              { value: "quiet", label: `Held back (${detail.cooling_down.length})` },
            ]}
            block
            data-testid="automation-section"
          />

          {Section && <Section drawer={drawer} catalogue={catalogue} />}

          <div>
            <Text strong className="nu-field-label">
              History
            </Text>
            <AuditTimeline resourceType="alert_rule" resourceId={detail.id} limit={8} />
          </div>

          {canEdit && (
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={remove.isPending}
              onClick={() =>
                modal.confirm({
                  title: `Withdraw ${detail.name}?`,
                  content:
                    "It stops watching immediately. Its run history is kept, and nothing it has already sent is undone.",
                  okText: "Withdraw",
                  okButtonProps: { danger: true },
                  onOk: () => remove.mutateAsync(),
                })
              }
              data-testid="delete-automation"
            >
              Withdraw this automation
            </Button>
          )}
        </Space>
      )}
    </Drawer>
  );
}
