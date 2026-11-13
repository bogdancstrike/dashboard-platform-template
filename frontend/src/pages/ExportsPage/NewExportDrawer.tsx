import { Alert, Button, Drawer, Form, Select, Skeleton, Space, Typography } from "antd";

import { formatNumber } from "@/lib/formats";

import { advice } from "./exportCopy";
import type { useExportsPage } from "./useExportsPage";

const { Paragraph } = Typography;

/**
 * Ask for an export: a dataset and a format, with the count answered before
 * anything is queued. The choices live on the page, so closing and reopening
 * shows the same ones.
 */
export function NewExportDrawer({ page }: { page: ReturnType<typeof useExportsPage> }) {
  const { composing, setComposing, dataset, setDataset, format, setFormat, catalogue, estimate, queued } = page;
  return (
    <Drawer
      className="nx-ad-drawer"
      title="New export"
      width={480}
      open={composing}
      onClose={() => setComposing(false)}
      data-testid="new-export-drawer"
      footer={
        <Space className="nu-exp-actions">
          <Button onClick={() => setComposing(false)}>Cancel</Button>
          <Button
            type="primary"
            data-testid="queue-export"
            loading={queued.isPending}
            // Refused before it is pressed rather than after: the estimate
            // has already answered whether this query is exportable at all.
            disabled={!dataset || estimate.isLoading || estimate.data?.too_large === true}
            onClick={() => queued.mutate()}
          >
            {estimate.data?.can_stream ? "Export it" : "Queue it"}
          </Button>
        </Space>
      }
    >
      <Form layout="vertical">
        {/* `htmlFor` and `id` in pairs: without them AntD renders a label
            that neither names the control in the accessibility tree nor
            focuses it when clicked, and `Form.Item` only generates the link
            for fields it owns by `name`. */}
        <Form.Item label="Dataset" htmlFor="exp-dataset">
          <Select
            id="exp-dataset"
            value={dataset || undefined}
            onChange={setDataset}
            placeholder="Choose a dataset"
            options={(catalogue.data?.datasets ?? []).map((entry) => ({
              value: entry.key,
              label: entry.label,
            }))}
          />
        </Form.Item>
        <Form.Item label="Format" htmlFor="exp-format">
          <Select
            id="exp-format"
            value={format}
            onChange={setFormat}
            options={(catalogue.data?.formats ?? []).map((entry) => ({
              value: entry.key,
              label: `${entry.label} — up to ${formatNumber(entry.maximum)} rows`,
            }))}
          />
        </Form.Item>
      </Form>

      {estimate.isLoading ? (
        <Skeleton active paragraph={{ rows: 2 }} />
      ) : estimate.data ? (
        <Alert
          type={estimate.data.too_large ? "error" : "info"}
          showIcon
          data-testid="estimate"
          message={advice(estimate.data)}
          description={estimate.data.description}
        />
      ) : null}

      {catalogue.data ? (
        <Paragraph type="secondary" className="nu-exp-limits" data-testid="limits">
          A download stops at {formatNumber(catalogue.data.streams_up_to)} rows. A queued
          export goes up to {formatNumber(catalogue.data.max_rows)}, and its file is kept
          for {catalogue.data.retention_days} days.
        </Paragraph>
      ) : null}
    </Drawer>
  );
}
