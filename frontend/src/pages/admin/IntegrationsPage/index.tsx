/**
 * `/admin/integrations` — what this platform talks to (§26).
 *
 * Five decisions worth stating.
 *
 * **The rows that need somebody come first, and are counted at the top.**
 * Twelve providers of which three are broken is a page whose whole value is
 * telling you which three. Everything else is a directory.
 *
 * **"Switched on" and "working" are two facts, shown as two.** An integration
 * somebody enabled that is now failing is the row this screen exists for, and
 * collapsing intent and outcome into one badge would hide it — the reader would
 * see "error" and not know whether anybody expects it to be running.
 *
 * **A check reports what it checked.** The button says "Check settings", not
 * "Test connection", and the result says in words that the provider was not
 * contacted. A green tick claiming a connection nothing attempted would be the
 * worst possible lie on this screen, and the note points at the one function to
 * replace to make it real.
 *
 * **A secret shows as set, never shown.** The server sends a redaction and the
 * field offers a replacement — and sending the redaction back means "leave it
 * alone", so a save of some other field cannot overwrite a token with bullets.
 *
 * **There is no "add integration".** The providers come with the code; an
 * operator extends the list by deploying, not by typing a name. A button that
 * implied otherwise would be a promise the platform cannot keep (§76).
 */

import { Alert, Button, Drawer, Input, Skeleton, Space, Table, Tag, Tooltip } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

import type { Integration } from "@/api/integrations";
import { URL_OVERLAY } from "@/app/history";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { apiMessage } from "@/lib/errors";

import { IntegrationFilters } from "./IntegrationFilters";
import { IntegrationPanel } from "./IntegrationPanel";
import { byAttention } from "./integrationCopy";
import { integrationColumns } from "./integrationColumns";
import { useIntegrationsPage } from "./useIntegrationsPage";

export { situation, stateTone } from "./integrationCopy";

type Page = ReturnType<typeof useIntegrationsPage>;

export default function IntegrationsPage() {
  const page = useIntegrationsPage();
  const { search, category, overlay, catalogue, listing, toggle } = page;

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (catalogue.isError) {
    return (
      <div className="nx-ad nx-ad--integrations">
        <PageHeader title="Integrations" />
        <Alert type="error" showIcon message={apiMessage(catalogue.error, "The integrations could not be read.")} />
      </div>
    );
  }

  const { categories, states, needing_attention: attention, redacted, total } = catalogue.data!;

  return (
    <div className="nu-fill nx-ad nx-ad--integrations">
      <PageHeader
        title="Integrations"
        subtitle="What this platform talks to, what each one needs, and whether it is working."
        tag={attention > 0 ? <Tag color="warning">{attention} need attention</Tag> : <Tag>nothing broken</Tag>}
        actions={
          <Space size={8}>
            <Input.Search
              allowClear
              placeholder="Name or provider"
              aria-label="Search integrations"
              style={{ width: 220 }}
              value={search.box}
              onChange={(event) => search.setBox(event.target.value)}
            />
            <Tooltip title="Read it again">
              <Button
                icon={<ReloadOutlined />}
                aria-label="Refresh the integrations"
                loading={listing.isFetching}
                onClick={() => void listing.refetch()}
              />
            </Tooltip>
          </Space>
        }
      />

      {/* The reason to open this page, said first. */}
      {attention > 0 && (
        <Alert
          className="nu-block"
          type="warning"
          showIcon
          data-testid="attention"
          message={`${attention} ${attention === 1 ? "integration is" : "integrations are"} switched on and not connected`}
          description="They are at the top of the list. Everything below them is either working or switched off."
        />
      )}

      <IntegrationFilters
        total={total}
        categories={categories}
        states={states}
        category={category}
        onCategory={(next) => search.set({ category: next })}
      />

      <div className="nu-pane nu-pane--table">
        <Table<Integration>
          size="small"
          rowKey="id"
          data-testid="integrations-table"
          columns={integrationColumns(toggle)}
          dataSource={byAttention(listing.data?.items ?? [])}
          loading={listing.isLoading}
          onRow={(row) => ({ onClick: () => overlay.open(row.id), style: { cursor: "pointer" } })}
          rowClassName={(row) => (row.enabled && row.state !== "CONNECTED" ? "nu-int-row is-attention" : "nu-int-row")}
          locale={{
            emptyText: (
              <EmptyState compact title={search.term || category ? "No integration matches that." : "None configured."} />
            ),
          }}
          pagination={false}
        />
      </div>

      <IntegrationDrawer page={page} redacted={redacted} />
    </div>
  );
}

function IntegrationDrawer({ page, redacted }: { page: Page; redacted: string }) {
  const { overlay, detail, check, configure, toggle } = page;
  return (
    <Drawer
      className="nx-ad-drawer"
      open={overlay.value !== null}
      rootClassName={URL_OVERLAY}
      onClose={overlay.close}
      width={620}
      title={detail.data?.name ?? "Integration"}
      destroyOnClose
    >
      {detail.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}
      {detail.isError && <Alert type="error" showIcon message={apiMessage(detail.error, "That integration could not be read.")} />}
      {detail.data && (
        <IntegrationPanel
          row={detail.data}
          redacted={redacted}
          busy={configure.isPending || check.isPending || toggle.isPending}
          checking={check.isPending}
          lastCheck={check.data?.id === detail.data.id ? check.data : null}
          onCheck={() => check.mutate(detail.data.id)}
          onSave={(configuration) => configure.mutate({ id: detail.data.id, configuration })}
        />
      )}
    </Drawer>
  );
}
