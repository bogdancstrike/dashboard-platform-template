/**
 * The data catalogue (§65, §71) — what the platform holds, and how good it is.
 *
 * Every other screen asks a question of the data; this one describes the data
 * itself, so somebody can find out what is worth asking. It answers three
 * questions per dataset: what fields exist and what each accepts, how many
 * records actually carry a value for them, and when anything last changed.
 *
 * Completeness is measured rather than asserted, and shown beside the count it
 * came from: "73% (44 of 60)" is a fact somebody can act on, where a bare bar
 * is a decoration. Every entry ends in the same place — a link that opens the
 * dataset in Data Explorer, because the catalogue exists to start explorations,
 * not to be read.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Alert,
  Card,
  Collapse,
  Empty,
  Input,
  Progress,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DatabaseOutlined, SearchOutlined } from "@ant-design/icons";

import { catalogApi, type CatalogDataset, type CatalogField } from "@/api/catalog";
import { PageHeader } from "@/components/PageHeader";

const { Text } = Typography;

/** Below this, a field is sparse enough that a filter on it hides rows twice. */
const SPARSE = 50;

export default function DataCatalogPage() {
  const [term, setTerm] = useState("");
  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: ({ signal }) => catalogApi.datasets(signal),
    staleTime: 60_000,
  });

  const needle = term.trim().toLowerCase();
  const datasets = useMemo(() => {
    const items = catalog.data?.items ?? [];
    if (!needle) return items;
    // A dataset stays when it matches, or when any of its fields does — this
    // is how somebody finds "which dataset has a serial number?".
    return items.filter(
      (dataset) =>
        `${dataset.label} ${dataset.description}`.toLowerCase().includes(needle) ||
        dataset.fields.some((field) =>
          `${field.label} ${field.name}`.toLowerCase().includes(needle),
        ),
    );
  }, [catalog.data, needle]);

  return (
    <>
      <PageHeader
        title="Data catalogue"
        subtitle="Every dataset you can read, its fields, what they accept and how completely they are filled in."
        actions={
          catalog.data && (
            <Space size="large">
              <Statistic title="Datasets" value={catalog.data.total} />
              <Statistic title="Fields" value={catalog.data.field_count} />
              <Statistic title="Records" value={catalog.data.record_count} />
            </Space>
          )
        }
      />

      {catalog.isError && (
        <Alert
          type="error"
          showIcon
          message="The catalogue could not be loaded"
          description={catalog.error instanceof Error ? catalog.error.message : "Unknown error"}
        />
      )}

      <Card size="small">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          aria-label="Filter the catalogue"
          placeholder="Filter by dataset or field name…"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </Card>

      {catalog.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}

      {catalog.data && datasets.length === 0 && (
        <Empty description={`No dataset or field matches “${term}”`} />
      )}

      {datasets.length > 0 && (
        <Collapse
          className="nu-catalog"
          data-testid="catalog"
          defaultActiveKey={datasets[0]?.key}
          items={datasets.map((dataset) => ({
            key: dataset.key,
            label: <DatasetHeading dataset={dataset} />,
            children: <DatasetBody dataset={dataset} highlight={needle} />,
          }))}
        />
      )}
    </>
  );
}

function DatasetHeading({ dataset }: { dataset: CatalogDataset }) {
  return (
    <div className="nu-catalog-heading">
      <Space>
        <DatabaseOutlined />
        <Text strong>{dataset.label}</Text>
        <Text type="secondary">{dataset.description}</Text>
      </Space>
      <Space size={6}>
        <Tag>{dataset.record_count.toLocaleString()} records</Tag>
        <Tag>{dataset.fields.length} fields</Tag>
        {dataset.updated_at && (
          <Tooltip title="When anything in this dataset last changed">
            <Tag>updated {new Date(dataset.updated_at).toLocaleDateString()}</Tag>
          </Tooltip>
        )}
      </Space>
    </div>
  );
}

function DatasetBody({ dataset, highlight }: { dataset: CatalogDataset; highlight: string }) {
  const columns: ColumnsType<CatalogField> = [
    {
      key: "label",
      dataIndex: "label",
      title: "Field",
      render: (label: string, field) => (
        <Space direction="vertical" size={0}>
          <Text strong>{label}</Text>
          <Text type="secondary" className="nu-catalog-name">{field.name}</Text>
        </Space>
      ),
    },
    {
      key: "kind",
      dataIndex: "kind",
      title: "Type",
      width: 110,
      render: (kind: string) => <Tag>{kind}</Tag>,
    },
    {
      key: "completeness",
      title: "Filled in",
      width: 180,
      sorter: (a, b) => a.completeness - b.completeness,
      render: (_value, field) => (
        <Tooltip title={`${field.filled.toLocaleString()} of ${dataset.record_count.toLocaleString()} records`}>
          <Progress
            percent={field.completeness}
            size="small"
            // Sparse is not broken: an optional field is allowed to be empty.
            // The colour marks where a filter will narrow twice, no more.
            status={field.completeness < SPARSE ? "normal" : "success"}
            strokeColor={field.completeness < SPARSE ? "var(--nu-warning)" : undefined}
            format={(percent) => `${percent}%`}
          />
        </Tooltip>
      ),
    },
    {
      key: "usage",
      title: "Used for",
      render: (_value, field) => (
        <Space size={4} wrap>
          {field.searchable && <Tag color="blue">search</Tag>}
          {field.facet && <Tag color="purple">facet</Tag>}
          {field.sortable && <Tag>sort</Tag>}
          {!field.filterable && <Tag color="default">read-only</Tag>}
        </Space>
      ),
    },
    {
      key: "operators",
      title: "Accepts",
      render: (_value, field) =>
        field.operators.length === 0 ? (
          <Text type="secondary">—</Text>
        ) : (
          <Text type="secondary" className="nu-catalog-operators">
            {field.operators.join(" · ")}
          </Text>
        ),
    },
    {
      key: "choices",
      title: "Values",
      render: (_value, field) =>
        field.choices.length === 0 ? (
          <Text type="secondary">—</Text>
        ) : (
          <Space size={4} wrap>
            {field.choices.slice(0, 4).map((choice) => (
              <Tag key={choice}>{choice}</Tag>
            ))}
            {field.choices.length > 4 && <Text type="secondary">+{field.choices.length - 4}</Text>}
          </Space>
        ),
    },
  ];

  const fields = highlight
    ? dataset.fields.filter((field) =>
        `${field.label} ${field.name}`.toLowerCase().includes(highlight),
      )
    : dataset.fields;

  return (
    <>
      {dataset.notes.map((note) => (
        <Alert
          key={note.message}
          className="nu-catalog-note"
          type={note.level}
          showIcon
          message={note.message}
        />
      ))}

      <Table
        rowKey="name"
        size="small"
        dataSource={fields.length > 0 ? fields : dataset.fields}
        columns={columns}
        pagination={false}
        scroll={{ x: "max-content" }}
      />

      <div className="nu-catalog-actions">
        <Link to={`/explore?resource=${dataset.key}`} data-testid={`explore-${dataset.key}`}>
          Explore {dataset.label.toLowerCase()} →
        </Link>
      </div>
    </>
  );
}
