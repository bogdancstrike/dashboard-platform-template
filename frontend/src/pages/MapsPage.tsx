/**
 * `/maps` — where the business actually is (§44, §61).
 *
 * A list sorted by country tells you which country is first. A map tells you
 * that everything is in a band across northern Europe and one dot is in Tokyo,
 * which is a fact about the business that no ordering of rows conveys.
 *
 * Three decisions worth stating.
 *
 * **Two layers, because place has two levels.** The choropleth shades each
 * country by what was measured there; the markers sit on the cities, sized by
 * the same measure. A shaded Germany does not say whether that is Munich or
 * Berlin, and a scatter of dots does not say that Germany is twice France.
 *
 * **What cannot be placed is on the screen, not in the gap.** A row whose city
 * is not in the gazetteer is real. "60 orders, 4 of which we cannot place" is
 * the honest sentence; a map that draws 56 dots and says nothing is answering
 * a different question from the list beside it.
 *
 * **A drill-down goes where the data actually is.** Customers and devices
 * carry their own place, so clicking one filters their own list. Orders,
 * tickets and projects are drawn at their *customer's* city — so clicking one
 * opens the customers there, and the link says so rather than pretending the
 * order list can be filtered by a column it does not have.
 */

import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Col, Empty, Row, Select, Skeleton, Space, Table, Tag, Typography } from "antd";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { mapsApi, type MapBucket, type MapPoint } from "@/api/maps";
import { analysisApi } from "@/api/analysis";
import { PageHeader } from "@/components/PageHeader";
import { withOrigin } from "@/entities/drilldown";
import { WorldMap } from "@/components/maps/WorldMap";
import { usePageCommands } from "@/commands/CommandContext";
import { formatNumber } from "@/lib/formats";

const { Text } = Typography;

/**
 * Where clicking a place leads, per dataset.
 *
 * Read off what each list can actually be filtered by, which is not the same
 * question as what the map can draw: a device is placed by `location`, a
 * customer by `country` and `city`, and an order by neither — it borrowed its
 * customer's. Rather than invent a filter the API would reject, a dataset
 * placed through its customer drills into the customers.
 */
const DRILL: Record<string, { path: string; country?: string; city: string; via?: boolean }> = {
  customer: { path: "/customers", country: "country", city: "city" },
  device: { path: "/devices", city: "location" },
  order: { path: "/customers", country: "country", city: "city", via: true },
  ticket: { path: "/customers", country: "country", city: "city", via: true },
  project: { path: "/customers", country: "country", city: "city", via: true },
};

export default function MapsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // The router's location rather than the window's: under a MemoryRouter they
  // are different addresses, and the window's is the wrong one.
  const location = useLocation();

  const catalogue = useQuery({
    queryKey: ["maps-catalogue"],
    queryFn: ({ signal }) => mapsApi.catalogue(signal),
    staleTime: 300_000,
  });

  // The period vocabulary the analytics workspace and both builders use, so
  // "last 90 days" means one thing across the ANALYSE section (§44).
  const analysis = useQuery({
    queryKey: ["analysis-catalogue"],
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: 300_000,
  });

  const datasets = catalogue.data?.datasets ?? [];
  const dataset = params.get("dataset") ?? datasets[0]?.key ?? "customer";
  const chosen = datasets.find((item) => item.key === dataset);
  const metric = params.get("metric") ?? chosen?.metrics[0]?.key ?? "count";
  const period = params.get("period") ?? "all_time";

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const places = useQuery({
    queryKey: ["maps-places", dataset, metric, period],
    queryFn: ({ signal }) => mapsApi.places({ dataset, metric, period }, signal),
    enabled: Boolean(chosen),
    placeholderData: (previous) => previous,
  });

  const here = () => `${location.pathname}${location.search}`;
  const drill = DRILL[dataset];

  const openCity = (city: string) => {
    if (!drill) return;
    navigate(withOrigin(`${drill.path}?f.${drill.city}=${encodeURIComponent(city)}`, here()));
  };
  /** The map names countries its own way; the list filters by the record's. */
  const openCountry = (mapName: string) => {
    if (!drill?.country) return;
    const point = places.data?.points.find((item) => item.map_name === mapName);
    if (point) {
      navigate(
        withOrigin(`${drill.path}?f.${drill.country}=${encodeURIComponent(point.country)}`, here()),
      );
    }
  };

  usePageCommands("maps", [
    {
      id: "maps.customers",
      label: "Map the customers",
      keywords: "accounts where",
      run: () => set({ dataset: "customer", metric: null }),
    },
    {
      id: "maps.revenue",
      label: "Map the revenue",
      keywords: "orders money where",
      run: () => set({ dataset: "order", metric: "revenue" }),
    },
    {
      id: "maps.fleet",
      label: "Map the fleet",
      keywords: "devices hardware where",
      run: () => set({ dataset: "device", metric: null }),
    },
  ]);

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (catalogue.isError || places.isError) {
    const error = (catalogue.error ?? places.error) as Error;
    const api = error instanceof ApiError ? error : null;
    return (
      <>
        <PageHeader title="Maps" />
        <Alert
          type={api?.isForbidden ? "warning" : "error"}
          showIcon
          message={api?.message ?? "The map could not be loaded"}
          description={
            api ? (
              <Space direction="vertical" size={4}>
                {api.missingPermissions.length > 0 && (
                  <Text type="secondary">Missing: {api.missingPermissions.join(", ")}</Text>
                )}
                <Text code copyable={{ text: api.correlationId }}>
                  {api.correlationId}
                </Text>
              </Space>
            ) : undefined
          }
        />
      </>
    );
  }

  const answer = places.data;
  const unplaced = answer?.unplaced.rows ?? 0;
  const money = answer?.metric.field === "total" || answer?.metric.field === "lifetime_value";
  const reads = (value: number) =>
    money ? `${formatNumber(Math.round(value))} EUR` : formatNumber(Math.round(value));

  return (
    <>
      <PageHeader
        title="Maps"
        subtitle={
          chosen
            ? `${chosen.label} placed by ${chosen.placed_by}, shaded and sized by ${answer?.metric.label.toLowerCase() ?? "count"}.`
            : "Where the records are."
        }
      />

      <Card size="small" data-testid="map-controls">
        <Space size={12} wrap>
          <Select
            aria-label="Dataset"
            style={{ minWidth: 180 }}
            value={dataset}
            onChange={(next) => set({ dataset: next, metric: null })}
            options={datasets.map((item) => ({ value: item.key, label: item.label }))}
          />
          <Select
            aria-label="Measure"
            style={{ minWidth: 180 }}
            value={metric}
            onChange={(next) => set({ metric: next })}
            options={(chosen?.metrics ?? []).map((item) => ({
              value: item.key,
              label: item.label,
            }))}
          />
          <Select
            aria-label="Period"
            style={{ minWidth: 180 }}
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

      <Card size="small" className="nu-block" data-testid="world-map">
        {places.isLoading && !answer ? (
          <Skeleton active paragraph={{ rows: 10 }} />
        ) : !answer || answer.points.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={`No ${chosen?.label.toLowerCase() ?? "records"} in this period could be placed`}
          />
        ) : (
          <figure className="nu-map" style={{ margin: 0 }}>
            {/* A canvas has no text and no tab stop. Rather than pretend
                otherwise, the picture names what it shows and points at the
                tables underneath, which carry the same numbers as rows a
                screen reader and a keyboard can both reach (§54, §55). */}
            <div
              role="img"
              aria-label={`${answer.dataset_label} by place: ${answer.points
                .slice(0, 5)
                .map((point) => `${point.city} ${reads(point.value)}`)
                .join(", ")}${answer.points.length > 5 ? ", and more" : ""}`}
            >
              <WorldMap
                points={answer.points}
                countries={answer.countries}
                unit={answer.metric.label}
                onSelectCity={openCity}
                onSelectCountry={openCountry}
              />
            </div>
            <figcaption>
              Drag to pan, scroll to zoom. Click a country or a city to open the
              records there — or read the same figures in the tables below.
            </figcaption>
          </figure>
        )}
      </Card>

      {unplaced > 0 && (
        <Alert
          className="nu-block"
          type="info"
          showIcon
          message={`${formatNumber(unplaced)} of ${formatNumber(answer?.total ?? 0)} could not be placed`}
          description="They name somewhere the gazetteer does not know, or no place at all. They are counted in the total above and drawn nowhere — so the map and the list agree about how many records there are."
        />
      )}

      <Row gutter={[12, 12]} className="nu-block">
        <Col xs={24} lg={12}>
          <Bucket
            title="By region"
            testId="map-regions"
            rows={answer?.regions ?? []}
            loading={places.isFetching && !answer}
            reads={reads}
            measure={answer?.metric.label ?? ""}
          />
        </Col>
        <Col xs={24} lg={12}>
          <Bucket
            title="By country"
            testId="map-countries"
            rows={answer?.countries ?? []}
            loading={places.isFetching && !answer}
            reads={reads}
            measure={answer?.metric.label ?? ""}
            onOpen={drill?.country ? openCountry : undefined}
            hint={
              drill?.via
                ? "Opens the customers there — an order carries no country of its own."
                : undefined
            }
          />
        </Col>
        <Col xs={24}>
          <Cities
            rows={answer?.points ?? []}
            loading={places.isFetching && !answer}
            reads={reads}
            measure={answer?.metric.label ?? ""}
            onOpen={drill ? openCity : undefined}
            hint={
              drill?.via
                ? "Opens the customers there — an order carries no city of its own."
                : undefined
            }
          />
        </Col>
      </Row>
    </>
  );
}

/**
 * The cities, as rows.
 *
 * The map merges markers that would overlap (§50), which is right for the
 * picture and would be wrong as the only answer: at a wide zoom thirteen of
 * these are inside three bubbles, and a reader who wants Munich rather than
 * "central Europe" needs somewhere to read it. This is also the keyboard and
 * screen-reader path to the same numbers, which a canvas cannot be (§55).
 */
function Cities({
  rows,
  loading,
  reads,
  measure,
  onOpen,
  hint,
}: {
  rows: MapPoint[];
  loading: boolean;
  reads: (value: number) => string;
  measure: string;
  onOpen?: (city: string) => void;
  hint?: string;
}) {
  return (
    <Card
      size="small"
      title="By city"
      data-testid="map-cities"
      extra={hint ? <Text type="secondary">{hint}</Text> : undefined}
    >
      <Table<MapPoint>
        size="small"
        rowKey="city"
        loading={loading}
        pagination={rows.length > 12 ? { pageSize: 12, size: "small" } : false}
        dataSource={rows}
        locale={{ emptyText: "Nothing placed yet" }}
        onRow={(row) =>
          onOpen ? { onClick: () => onOpen(row.city), style: { cursor: "pointer" } } : {}
        }
        columns={[
          { title: "City", dataIndex: "city" },
          { title: "Country", dataIndex: "country" },
          { title: "Region", dataIndex: "region_name", responsive: ["lg"] },
          {
            title: "Records",
            dataIndex: "rows",
            width: 100,
            align: "right",
            render: (value: number) => formatNumber(value),
          },
          {
            title: measure,
            dataIndex: "value",
            width: 140,
            align: "right",
            render: (value: number) => reads(value),
          },
        ]}
      />
    </Card>
  );
}

/** One level of the same answer, as a table beside the picture. */
function Bucket({
  title,
  testId,
  rows,
  loading,
  reads,
  measure,
  onOpen,
  hint,
}: {
  title: string;
  testId: string;
  rows: MapBucket[];
  loading: boolean;
  reads: (value: number) => string;
  measure: string;
  onOpen?: (name: string) => void;
  hint?: string;
}) {
  return (
    <Card
      size="small"
      title={title}
      data-testid={testId}
      extra={hint ? <Text type="secondary">{hint}</Text> : undefined}
    >
      {/* Every blob on the map is also a row here. A coloured shape is not a
          finding, and not everybody sees colour (§55). */}
      <Table<MapBucket>
        size="small"
        rowKey="name"
        loading={loading}
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: "Nothing here yet" }}
        onRow={(row) =>
          onOpen
            ? { onClick: () => onOpen(row.name), style: { cursor: "pointer" } }
            : {}
        }
        columns={[
          { title: "Place", dataIndex: "name" },
          {
            title: "Cities",
            dataIndex: "cities",
            width: 80,
            align: "right",
            render: (value: number) => formatNumber(value),
          },
          {
            title: "Records",
            dataIndex: "rows",
            width: 100,
            align: "right",
            render: (value: number) => formatNumber(value),
          },
          {
            title: measure,
            dataIndex: "value",
            width: 140,
            align: "right",
            render: (value: number) => reads(value),
          },
        ]}
      />
    </Card>
  );
}
