import { useQuery } from "@tanstack/react-query";
import { Skeleton, Typography } from "antd";

import type { DashboardWidget } from "@/api/dashboards";
import { mapsApi } from "@/api/maps";
import { WorldMap } from "@/components/maps/WorldMap";
import { EmptyState } from "@/components/EmptyState";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { WidgetError } from "../WidgetError";

const { Text } = Typography;

/**
 * Records on a map, from the endpoint `/maps` reads.
 *
 * Deliberately not the analysis compiler: a place is usually one join away —
 * an order is drawn at its *customer's* city — and `services/maps.py` is where
 * that join lives. A widget that grouped by a city column would quietly show a
 * different set of rows from the page it mirrors.
 *
 * What it will not do is hide the rows it could not draw. The endpoint counts
 * them, and a map that silently omits four hundred unplaced records answers a
 * different question from the list beside it (§34).
 */
export function MapBody({ widget, period }: { widget: DashboardWidget; period: string }) {
  const dataset = widget.config.entity ?? "";
  const params = {
    dataset,
    ...(widget.config.metric ? { metric: widget.config.metric } : {}),
    period,
  };

  const places = useQuery({
    queryKey: queryKeys.mapPlaces(params),
    queryFn: ({ signal }) => mapsApi.places(params, signal),
    enabled: Boolean(dataset),
    staleTime: STALE.minute,
  });

  if (places.isLoading) return <Skeleton active title={false} paragraph={{ rows: 5 }} />;
  if (places.isError) return <WidgetError error={places.error} entity={dataset} />;

  const data = places.data;
  if (!data || data.points.length === 0) {
    return <EmptyState compact title="Nothing placed in this period" />;
  }

  return (
    <div className="nu-widget-map">
      <WorldMap points={data.points} countries={data.countries} unit={data.metric.label} height={190} />
      <Text type="secondary" className="nu-widget-dim">
        {data.measured.toLocaleString()} of {data.total.toLocaleString()} placed
        {data.unplaced.rows > 0 ? ` · ${data.unplaced.rows.toLocaleString()} without a place` : ""}
      </Text>
    </div>
  );
}
