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
import { Alert, Collapse, Input, Skeleton } from "antd";
import { ClearOutlined, DeploymentUnitOutlined, SearchOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { usePageCommands } from "@/commands/CommandContext";

import { catalogApi } from "@/api/catalog";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { DatasetBody, DatasetHeading } from "./DatasetParts";

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
