/** What the page reads, what it keeps in the address, and what it derives. */

import { useQuery } from "@tanstack/react-query";
import { App as AntApp, Typography } from "antd";
import { useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { mapsApi } from "@/api/maps";
import { analysisApi } from "@/api/analysis";
import { withOrigin } from "@/entities/drilldown";
import { usePageCommands } from "@/commands/CommandContext";
import { formatNumber } from "@/lib/formats";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { applyParamChanges } from "@/hooks/useUrlState";

import { DRILL, DRILL_NOUN } from "./model";

const { Text } = Typography;

/** The page's state, queries and actions. */
export function useMapsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // The router's location rather than the window's: under a MemoryRouter they
  // are different addresses, and the window's is the wrong one.
  const location = useLocation();

  const catalogue = useQuery({
    queryKey: queryKeys.mapsCatalogue(),
    queryFn: ({ signal }) => mapsApi.catalogue(signal),
    staleTime: STALE.long,
  });

  // The period vocabulary the analytics workspace and both builders use, so
  // "last 90 days" means one thing across the ANALYSE section (§44).
  const analysis = useQuery({
    queryKey: queryKeys.analysisCatalogue(),
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: STALE.long,
  });

  const datasets = catalogue.data?.datasets ?? [];
  const dataset = params.get("dataset") ?? datasets[0]?.key ?? "customer";
  const chosen = datasets.find((item) => item.key === dataset);
  const metric = params.get("metric") ?? chosen?.metrics[0]?.key ?? "count";
  const period = params.get("period") ?? "all_time";

  const set = (changes: Record<string, string | null>) =>
    setParams((current) => applyParamChanges(current, changes), { replace: true });

  const places = useQuery({
    queryKey: queryKeys.mapsPlaces(dataset, metric, period),
    queryFn: ({ signal }) => mapsApi.places({ dataset, metric, period }, signal),
    enabled: Boolean(chosen),
    placeholderData: (previous) => previous,
  });

  /** Where the side list last flew the map, and which place that was. */
  // In the address and pushed, so back returns the map to where it was.
  const focusKey = params.get("place") ?? "";

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

  const { modal } = AntApp.useApp();
  /**
   * A country clicked on the map asks before leaving it (§74): a click on a
   * picture is easy to make by accident while panning, and the answer to "what
   * is in Germany" is partly here already — so the question shows that much,
   * and leaving is the second press, not the first.
   */
  const askCountry = (mapName: string) => {
    if (!drill?.country || !answer) return;
    const point = answer.points.find((item) => item.map_name === mapName);
    if (!point) return;
    const bucket = answer.countries.find((item) => item.name === point.country);
    const rows = bucket?.rows ?? 0;
    const cities = answer.points
      .filter((item) => item.country === point.country)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
    const noun = DRILL_NOUN[dataset] ?? "records";
    modal.confirm({
      title: `Open the ${formatNumber(rows)} ${noun} in ${point.country}?`,
      icon: null,
      className: "nx-ov-countryask",
      content: (
        <div className="nx-ov-countryask-body" data-testid="country-confirm">
          <Text type="secondary">It leaves the map for the list of records there.</Text>
          <ul>
            {cities.map((city) => (
              <li key={city.city}>
                <span>{city.city}</span>
                <b>{reads(city.value)}</b>
              </li>
            ))}
          </ul>
        </div>
      ),
      okText: "Open list",
      cancelText: "Stay on the map",
      autoFocusButton: "cancel",
      maskClosable: true,
      onOk: () => openCountry(mapName),
    });
  };

  const focusPoint = places.data?.points.find((item) => item.city === focusKey);
  const focus = useMemo(
    () =>
      focusPoint
        ? { longitude: focusPoint.longitude, latitude: focusPoint.latitude, zoom: 7 }
        : { longitude: 8, latitude: 38, zoom: 2.4 },
    [focusPoint],
  );

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

  const answer = places.data;
  const unplaced = answer?.unplaced.rows ?? 0;
  const money = answer?.metric.field === "total" || answer?.metric.field === "lifetime_value";
  const reads = (value: number) =>
    money ? `${formatNumber(Math.round(value))} EUR` : formatNumber(Math.round(value));

  return {
    setParams,
    catalogue,
    analysis,
    datasets,
    dataset,
    chosen,
    metric,
    period,
    set,
    places,
    focusKey,
    drill,
    openCity,
    openCountry,
    askCountry,
    focus,
    answer,
    unplaced,
    reads,
  };
}

export type MapsPageData = ReturnType<typeof useMapsPage>;
