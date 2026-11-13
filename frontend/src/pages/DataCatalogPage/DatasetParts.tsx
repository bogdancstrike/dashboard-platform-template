import { Link } from "react-router-dom";
import { Alert, Progress, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DatabaseOutlined } from "@ant-design/icons";

import { type CatalogDataset, type CatalogField } from "@/api/catalog";

/** Below this, a field is sparse enough that a filter on it hides rows twice. */
const SPARSE = 50;

const { Text } = Typography;

export function DatasetHeading({ dataset }: { dataset: CatalogDataset }) {
  const filled = dataset.fields.length
    ? Math.round(dataset.fields.reduce((sum, field) => sum + field.completeness, 0) / dataset.fields.length)
    : 0;
  return (
    <div className="nu-catalog-heading nx-fd-catrow">
      <span className="nx-fd-catname">
        <span className="nx-fd-roundicon"><DatabaseOutlined /></span>
        <span className="nx-fd-grow">
          <Text strong>{dataset.label}</Text>
          <span className="nx-fd-muted nx-fd-small nx-fd-catdesc">
            {dataset.record_count.toLocaleString()} records · {dataset.description}
          </span>
        </span>
      </span>
      <span className="nx-fd-catperm">
        <span className="nx-fd-pill">{dataset.permission}</span>
      </span>
      <span className="nx-fd-catnum">
        <b>{dataset.fields.length}</b>
        <span className="nx-fd-muted nx-fd-tiny"> fields</span>
      </span>
      <span className="nx-fd-catfill">
        <span className="nx-fd-adv-track"><span style={{ width: `${filled}%` }} className={filled < SPARSE ? "is-sparse" : ""} /></span>
        <span className="nx-fd-small">{filled}%</span>
      </span>
      <span className="nx-fd-muted nx-fd-small nx-fd-catupd">
        {dataset.updated_at ? (
          <Tooltip title="When anything in this dataset last changed">
            <span>{new Date(dataset.updated_at).toLocaleDateString()}</span>
          </Tooltip>
        ) : "—"}
      </span>
    </div>
  );
}

export function DatasetBody({ dataset, highlight }: { dataset: CatalogDataset; highlight: string }) {
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
            aria-label={`${field.label}: ${field.completeness}% of rows have a value`}
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
