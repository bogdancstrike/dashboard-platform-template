import { Button, Card, Input, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { dashboardsApi } from "@/api/dashboards";
import { DashboardCard } from "@/components/dashboards/DashboardCard";
import { COPY_MEANS, confirmCopy } from "@/lib/confirm";
import { EmptyState } from "@/components/EmptyState";
import { NxIcon } from "@/components/NxIcon";
import { queryKeys } from "@/lib/queryKeys";

import type { DashboardsPageData } from "../useDashboardsPage";

/** The gallery: each card says what its dashboard holds. */
export function DashboardGallery({ page }: { page: DashboardsPageData }) {
  const {
    queryClient,
    message,
    modal,
    setSettingsOpen,
    setWizardOpen,
    items,
    query,
    setQuery,
    sort,
    setSort,
    owner,
    setOwner,
    shown,
    open,
    duplicate,
    canCreate,
  } = page;
  return (
    <>
      <>
        {/* The gallery: what a reader is choosing between is a layout, so each */}
        {/* card says what its dashboard holds. */}
        {items.length === 0 ? (
          <Card size="small">
            <EmptyState
              compact
              title="No dashboards yet. One is three steps away."
              action={
                <>
                  {canCreate && (
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => setWizardOpen(true)}
                    >
                      New dashboard
                    </Button>
                  )}
                </>
              }
            />
          </Card>
        ) : (
          <>
            <div className="nx-ov-filterbar" role="search">
              <Input
                allowClear
                variant="filled"
                prefix={<NxIcon name="search" size={16} />}
                placeholder="Search"
                aria-label="Search dashboards"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Select
                aria-label="Sort"
                value={sort}
                onChange={setSort}
                popupMatchSelectWidth={false}
                className="nx-ov-chipselect is-ink"
                options={[
                  { value: "recent", label: "Sort: recent" },
                  { value: "name", label: "Sort: name" },
                  { value: "size", label: "Sort: most widgets" },
                ]}
              />
              <Select
                aria-label="Owner"
                value={owner}
                onChange={setOwner}
                popupMatchSelectWidth={false}
                className="nx-ov-chipselect"
                options={[
                  { value: "any", label: "Owner: anyone" },
                  { value: "me", label: "Owner: me" },
                  { value: "shared", label: "Owner: shared with me" },
                ]}
              />
            </div>
            {shown.length === 0 ? (
              <Card size="small">
                <EmptyState compact title="No dashboard matches that" />
              </Card>
            ) : (
              <div className="nu-boards" data-testid="dashboard-gallery">
                {shown.map((item) => (
                  <DashboardCard
                    key={item.id}
                    dashboard={item}
                    open={false}
                    canCopy={canCreate}
                    onCopy={() =>
                      confirmCopy(modal, {
                        what: item.name,
                        consequence:
                          "Every widget keeps pointing at the same reports and searches — a copy of the layout, not of the data. " +
                          COPY_MEANS,
                        onOk: () => duplicate.mutateAsync(item.id),
                      })
                    }
                    onOpen={() => open(item.id)}
                    onSettings={() => {
                      open(item.id);
                      setSettingsOpen(true);
                    }}
                    onDelete={() =>
                      modal.confirm({
                        title: `Delete ${item.name}?`,
                        content: "The layout goes. Nothing it pointed at is affected.",
                        okText: "Delete",
                        okButtonProps: { danger: true },
                        onOk: async () => {
                          await dashboardsApi.remove(item.id);
                          message.success(`${item.name} deleted`);
                          void queryClient.invalidateQueries({ queryKey: queryKeys.dashboards() });
                        },
                      })
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
      </>
    </>
  );
}
