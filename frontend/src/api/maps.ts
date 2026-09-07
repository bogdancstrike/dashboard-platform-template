import { api } from "./client";

/**
 * Records on a map (§44, §61).
 *
 * Deliberately not the analysis endpoint: a place is almost always one join
 * away — an order is drawn at its *customer's* city — and the compiler groups
 * a single table on purpose. See `services/maps.py` for why that line is
 * where it is.
 */

/** One city, where it is, and what was measured there. */
export interface MapPoint {
  city: string;
  country: string;
  /** What the vendored world map calls that country, which is not always the
   *  same string — see `core/geography.py:MAP_NAMES`. */
  map_name: string;
  /** The region code the database stores, and what to call it on a screen. */
  region: string;
  region_name: string;
  latitude: number;
  longitude: number;
  rows: number;
  value: number;
}

/** The same points added up one level higher — by country, or by region. */
export interface MapBucket {
  name: string;
  rows: number;
  value: number;
  cities: number;
}

export interface MapMetric {
  key: string;
  label: string;
  field: string;
}

export interface MapPlaces {
  dataset: string;
  dataset_label: string;
  /** Where this entity's list lives, for the drill-down (§44). */
  path: string;
  metric: MapMetric;
  period: { key: string; from: string | null; to: string | null };
  points: MapPoint[];
  countries: MapBucket[];
  regions: MapBucket[];
  /** Every row, including the ones that could not be drawn. */
  total: number;
  measured: number;
  /** Counted, never dropped: a map that omits rows answers a different
   *  question from the list beside it. */
  unplaced: { rows: number; value: number };
}

export interface MapCatalogue {
  datasets: {
    key: string;
    label: string;
    path: string;
    /** "own city" or "the customer's city" — said out loud, because a reader
     *  comparing two datasets is entitled to know. */
    placed_by: string;
    metrics: MapMetric[];
  }[];
  places: {
    city: string;
    country: string;
    map_name: string;
    region: string;
    region_name: string;
    latitude: number;
    longitude: number;
  }[];
}

export const mapsApi = {
  catalogue: (signal?: AbortSignal) => api.get<MapCatalogue>("/api/maps/catalog", { signal }),
  places: (
    params: { dataset: string; metric?: string; period?: string },
    signal?: AbortSignal,
  ) => api.get<MapPlaces>("/api/maps/places", { params, signal }),
};
