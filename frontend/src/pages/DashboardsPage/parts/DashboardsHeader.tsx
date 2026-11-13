import { Button, Tag, Tooltip } from "antd";
import {
  AppstoreOutlined,
  ColumnHeightOutlined,
  CopyOutlined,
  PlusOutlined,
  ShareAltOutlined,
  TeamOutlined,
} from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";
import { PublishButton } from "@/components/recordsAnalytics/PublicLinksDrawer";
import { autoArranged, compacted } from "@/components/dashboards/grid/arrange";
import { relativeTime } from "@/lib/time";
import { COPY_MEANS, confirmCopy } from "@/lib/confirm";
import { NxIcon } from "@/components/NxIcon";

import type { DashboardsPageData } from "../useDashboardsPage";

/** The title, the dashboard picker and the actions on the open one. */
export function DashboardsHeader({ page }: { page: DashboardsPageData }) {
  const {
    modal,
    back,
    setWidgetForm,
    setSettingsOpen,
    setShareOpen,
    setWizardOpen,
    items,
    openId,
    editing,
    setEditing,
    open,
    arrange,
    duplicate,
    board,
    columns,
    widgets,
    canCreate,
  } = page;
  return (
    <PageHeader
      title={
        openId && board ? (
          board.name
        ) : (
          <span>
            My <em>dashboards</em>
          </span>
        )
      }
      onBack={openId ? () => back(() => open("")) : undefined}
      subtitle={
        openId && board
          ? [
              board.owner.name,
              board.scope.toLowerCase(),
              `${board.widget_count} ${board.widget_count === 1 ? "widget" : "widgets"}`,
              board.updated_at ? relativeTime(board.updated_at) : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : `${items.length} ${items.length === 1 ? "dashboard" : "dashboards"} · ${
              items.filter((item) => !item.can_edit).length
            } shared with you`
      }
      tag={board?.is_home ? <Tag color="blue">Home</Tag> : undefined}
      actions={
        openId && board ? (
          <>
            {board.can_edit && (
              <Button
                type={editing ? "primary" : "default"}
                ghost={editing}
                icon={<NxIcon name="sliders" size={16} />}
                onClick={() => setEditing(!editing)}
                aria-pressed={editing}
                data-testid="toggle-edit"
              >
                {editing ? "Done" : "Customize"}
              </Button>
            )}
            {editing && board.can_edit && (
              <>
                {/* Two arrangers, because they answer different questions.
                    "Tidy up" is the rule the grid already applies during a
                    drag — close the gaps, leave everything where it is —
                    and it is what somebody wants after moving one card.
                    "Auto-arrange" also *packs the rows*, which is the only
                    thing that rescues a dashboard whose cards were each
                    dropped under the last and left half the width empty. */}
                <Button
                  icon={<ColumnHeightOutlined />}
                  loading={arrange.isPending}
                  disabled={widgets.length === 0}
                  onClick={() => arrange.mutate(compacted(widgets, columns))}
                  data-testid="tidy-up"
                >
                  Tidy up
                </Button>
                <Button
                  icon={<AppstoreOutlined />}
                  loading={arrange.isPending}
                  disabled={widgets.length === 0}
                  onClick={() => arrange.mutate(autoArranged(widgets, columns))}
                  data-testid="auto-arrange"
                >
                  Auto-arrange
                </Button>
              </>
            )}
            {/* Adopting somebody else's layout, which is the thing that
                makes sharing worth having. Offered exactly when it is the
                useful move — on a dashboard this reader cannot change. */}
            {!board.can_edit && canCreate && (
              <Button
                icon={<CopyOutlined />}
                loading={duplicate.isPending}
                onClick={() =>
                  confirmCopy(modal, {
                    what: board.name,
                    consequence:
                      "Every widget keeps pointing at the same reports and searches — a copy of the layout, not of the data. " +
                      COPY_MEANS,
                    onOk: () => duplicate.mutateAsync(board.id),
                  })
                }
                data-testid="duplicate-dashboard"
              >
                Make a copy
              </Button>
            )}
            {board.can_edit && (
              <Button
                icon={<ShareAltOutlined />}
                onClick={() => setShareOpen(true)}
                data-testid="board-share"
              >
                Share
              </Button>
            )}
            {/* Records & analytics (§25): a public, embeddable link. */}
            {board.can_edit && <PublishButton dashboardId={board.id} />}
            <Tooltip title={board.can_edit ? "" : "Only the owner may change a dashboard"}>
              {/* Addressed by test id, not by name: the icon contributes
                  its own label, so the accessible name reads "team
                  Settings" — the same trap the export control documents. */}
              <Button
                icon={<TeamOutlined />}
                disabled={!board.can_edit}
                onClick={() => setSettingsOpen(true)}
                data-testid="board-settings"
              >
                Settings
              </Button>
            </Tooltip>
            {board.can_edit && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setWidgetForm("new")}
                data-testid="add-widget"
              >
                Add widget
              </Button>
            )}
          </>
        ) : (
          <Tooltip title={canCreate ? "" : "Your role does not include dashboards.manage"}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canCreate}
              onClick={() => setWizardOpen(true)}
              data-testid="new-dashboard"
            >
              New dashboard
            </Button>
          </Tooltip>
        )
      }
    />
  );
}
