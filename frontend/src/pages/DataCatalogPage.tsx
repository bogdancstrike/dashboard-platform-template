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
  Collapse,
  Input,
  Progress,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  ClearOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { usePageCommands } from "@/commands/CommandContext";

import { catalogApi, type CatalogDataset, type CatalogField } from "@/api/catalog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { STALE, queryKeys } from "@/lib/queryKeys";

const { Text } = Typography;

/** Below this, a field is sparse enough that a filter on it hides rows twice. */
const SPARSE = 50;

export default function DataCatalogPage() {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const catalog = useQuery({
    queryKey: queryKeys.catalog(),
    queryFn: ({ signal }) => catalogApi.datasets(signal),
    staleTime: STALE.minute,
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

  /**
   * What this page can do, for the palette (§31).
   *
   * The catalogue is where somebody lands wondering *which* dataset has the
   * field they want; the useful commands are the two places they go next once
   * they know, plus a way to empty a search that matched nothing.
   */
  usePageCommands("catalog", [
    ...(needle
      ? [
          {
            id: "catalog.clear",
            label: "Clear the filter",
            icon: <ClearOutlined />,
            keywords: "reset empty all datasets",
            run: () => setTerm(""),
          },
        ]
      : []),
    {
      id: "catalog.explore",
      label: "Query a dataset in the explorer",
      icon: <SearchOutlined />,
      keywords: "explore query rows filter records",
      run: () => navigate("/explore"),
    },
    {
      id: "catalog.relationships",
      label: "See how the datasets connect",
      icon: <DeploymentUnitOutlined />,
      keywords: "graph relationships schema foreign keys links",
      run: () => navigate("/find/relationships"),
    },
  ]);

  return (
    <div className="nx-fd-catalog">
      <PageHeader
        title={<>Data <em>catalog</em></>}
        subtitle={
          catalog.data
            ? `${catalog.data.total} record types · ${catalog.data.field_count.toLocaleString()} fields · ${catalog.data.record_count.toLocaleString()} records — what each holds and who can read it`
            : "Every dataset you can read, its fields, what they accept and how completely they are filled in."
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

      <section className="nx-fd-bar nx-glass nx-glass--strong" aria-label="Filter">
        <div className="nx-fd-bar-row">
          <Input
            allowClear
            className="nx-fd-filter"
            prefix={<SearchOutlined />}
            aria-label="Filter the catalogue"
            placeholder="Search record types and fields"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          {catalog.data && (
            <div className="nx-fd-catstats" aria-label="Catalogue totals">
              <span><b>{catalog.data.total}</b> datasets</span>
              <span><b>{catalog.data.field_count.toLocaleString()}</b> fields</span>
              <span><b>{catalog.data.record_count.toLocaleString()}</b> records</span>
            </div>
          )}
        </div>
      </section>

      {catalog.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}

      {catalog.data && datasets.length === 0 && (
        <EmptyState title={`No dataset or field matches “${term}”`} />
      )}

      {datasets.length > 0 && (
        <section className="nx-fd-catpanel nx-glass" aria-label="Record types">
          <div className="nx-fd-cathead" aria-hidden="true">
            <span>Record type</span>
            <span>Visible with</span>
            <span className="is-num">Fields</span>
            <span>Filled in</span>
            <span>Updated</span>
          </div>
          <Collapse
            ghost
            className="nu-catalog nx-fd-catlist"
            data-testid="catalog"
            defaultActiveKey={datasets[0]?.key}
            expandIconPosition="end"
            items={datasets.map((dataset) => ({
              key: dataset.key,
              label: <DatasetHeading dataset={dataset} />,
              children: <DatasetBody dataset={dataset} highlight={needle} />,
            }))}
          />
        </section>
      )}
    </div>
  );
}

function DatasetHeading({ dataset }: { dataset: CatalogDataset }) {
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
