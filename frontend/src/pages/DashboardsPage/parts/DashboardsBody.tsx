import { Alert, Button, Card, Skeleton } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { ApiError } from "@/api/client";
import { WidgetBody } from "@/components/dashboards/WidgetBody";
import { WidgetCard } from "@/components/dashboards/WidgetCard";
import { WidgetGrid } from "@/components/dashboards/WidgetGrid";
import { EmptyState } from "@/components/EmptyState";

import type { DashboardsPageData } from "../useDashboardsPage";
import { DashboardGallery } from "./DashboardGallery";

/** The gallery of dashboards, or the open one's grid. */
export function DashboardsBody({ page }: { page: DashboardsPageData }) {
  const {
    pushes,
    place,
    openId,
    editing,
    dashboard,
    catalogue,
    resources,
    open,
    arrange,
    board,
    columns,
    widgets,
    period,
    moves,
  } = page;
  return (
    <>
      {!openId ? (
        <DashboardGallery page={page} />
      ) : dashboard.isLoading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : dashboard.isError ? (
        <Alert
          type="error"
          showIcon
          message={
            dashboard.error instanceof ApiError
              ? dashboard.error.message
              : "That dashboard could not be opened"
          }
          action={<Button onClick={() => open("")}>All dashboards</Button>}
        />
      ) : widgets.length === 0 ? (
        <Card size="small">
          <EmptyState
            compact
            title="No widgets yet"
            action={
              <>
                {board?.can_edit && (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      pushes.current = 1;
                      place({ edit: "1", widget: "new", wkind: null });
                    }}
                  >
                    Add the first one
                  </Button>
                )}
              </>
            }
          />
        </Card>
      ) : (
        <div data-testid="dashboard-grid">
          <WidgetGrid
            widgets={widgets}
            columns={columns}
            // Always movable for whoever may change the layout: a grid that only
            // moves after finding a mode switch is a grid people think is fixed.
            editable={Boolean(board?.can_edit)}
            onCommit={(placements) => arrange.mutate(placements)}
          >
            {(widget) => (
              <WidgetCard
                widget={widget}
                editable={editing && Boolean(board?.can_edit)}
                movable={Boolean(board?.can_edit)}
                columns={columns}
                moves={moves}
              >
                <WidgetBody
                  widget={widget}
                  period={period}
                  catalogue={catalogue.data}
                  resources={resources.data?.items ?? []}
                />
              </WidgetCard>
            )}
          </WidgetGrid>
        </div>
      )}
    </>
  );
}
