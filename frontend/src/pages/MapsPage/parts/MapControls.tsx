import { Card, Select, Space, Tag, Typography } from "antd";

import { formatNumber } from "@/lib/formats";

const { Text } = Typography;

import type { MapsPageData } from "../useMapsPage";

/** Which dataset, measured how, over what period. */
export function MapControls({ page }: { page: MapsPageData }) {
  const { analysis, datasets, dataset, chosen, metric, period, set, answer, unplaced } = page;
  return (
    <Card size="small" className="nx-ov-querybar" data-testid="map-controls">
      <Space size={12} wrap>
        <Select
          aria-label="Dataset"
          prefix="Dataset"
          popupMatchSelectWidth={false}
          className="nx-ov-labelselect"
          value={dataset}
          onChange={(next) => set({ dataset: next, metric: null })}
          options={datasets.map((item) => ({ value: item.key, label: item.label }))}
        />
        <Select
          aria-label="Measure"
          prefix="Measure"
          popupMatchSelectWidth={false}
          className="nx-ov-labelselect"
          value={metric}
          onChange={(next) => set({ metric: next })}
          options={(chosen?.metrics ?? []).map((item) => ({
            value: item.key,
            label: item.label,
          }))}
        />
        <Select
          aria-label="Period"
          prefix="Period"
          popupMatchSelectWidth={false}
          className="nx-ov-labelselect"
          value={period}
          onChange={(next) => set({ period: next })}
          options={[
            { value: "all_time", label: "All time" },
            ...(analysis.data?.periods ?? []).map((item) => ({
              value: item.key,
              label: item.label,
            })),
          ]}
        />
        {answer && (
          <Text type="secondary" data-testid="map-coverage">
            <span data-testid="map-total">{formatNumber(answer.total)}</span>{" "}
            {answer.dataset_label.toLowerCase()} · {answer.points.length}{" "}
            {answer.points.length === 1 ? "place" : "places"}
            {unplaced > 0 && (
              <>
                {" · "}
                <Tag color="warning" bordered={false}>
                  {formatNumber(unplaced)} we cannot place
                </Tag>
              </>
            )}
          </Text>
        )}
      </Space>
    </Card>
  );
}
