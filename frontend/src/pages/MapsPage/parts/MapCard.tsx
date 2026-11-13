import { Card, Skeleton } from "antd";

import { WorldMap } from "@/components/maps/WorldMap";
import { EmptyState } from "@/components/EmptyState";

import type { MapsPageData } from "../useMapsPage";

/** The map itself, and what it leaves out. */
export function MapCard({ page }: { page: MapsPageData }) {
  const { chosen, places, openCity, askCountry, focus, answer, reads } = page;
  return (
    <Card size="small" className="nu-block" data-testid="world-map">
      {places.isLoading && !answer ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : !answer || answer.points.length === 0 ? (
        <EmptyState
          compact
          title={`No ${chosen?.label.toLowerCase() ?? "records"} in this period could be placed`}
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
              onSelectCountry={askCountry}
              focus={focus}
            />
          </div>
          <figcaption>
            Drag to pan, scroll to zoom. Click a country or a city to open the records there — or
            read the same figures in the tables below.
          </figcaption>
        </figure>
      )}
    </Card>
  );
}
