import { Button, Card, Skeleton } from "antd";

import { NxIcon } from "@/components/NxIcon";
import { formatNumber } from "@/lib/formats";

import type { MapsPageData } from "../useMapsPage";

/** The places, biggest first: a press flies the map there, an arrow opens the records. */
export function PlacesCard({ page }: { page: MapsPageData }) {
  const { setParams, focusKey, drill, openCity, answer, reads } = page;
  return (
    <>
      {/* The places, as the canvas's side list: the biggest first, each a
          press that flies the map there, and an arrow to the records. */}
      <Card
        size="small"
        title="Places"
        className="nu-block nx-ov-panel nx-ov-places"
        data-testid="map-places"
      >
        {!answer ? (
          <Skeleton active paragraph={{ rows: 6 }} title={false} />
        ) : (
          <ul className="nx-ov-placelist">
            {[...answer.points]
              .sort((a, b) => b.value - a.value)
              .slice(0, 12)
              .map((point) => (
                <li key={`${point.city}-${point.country}`}>
                  <button
                    type="button"
                    className={`nx-ov-place${focusKey === point.city ? " is-on" : ""}`}
                    onClick={() =>
                      setParams(
                        (current) => {
                          const next = new URLSearchParams(current);
                          next.set("place", point.city);
                          return next;
                        },
                        { replace: false },
                      )
                    }
                    aria-label={`Show ${point.city} on the map`}
                  >
                    <span className="nx-ov-place-dot" aria-hidden />
                    <span className="nx-ov-place-text">
                      <b>{point.city}</b>
                      <small>
                        {point.region_name} · {formatNumber(point.rows)}{" "}
                        {point.rows === 1 ? "record" : "records"}
                      </small>
                    </span>
                    <span className="nx-ov-place-value">{reads(point.value)}</span>
                  </button>
                  {drill && (
                    <Button
                      type="text"
                      aria-label={`Open the records in ${point.city}`}
                      icon={<NxIcon name="chevronRight" size={14} />}
                      onClick={() => openCity(point.city)}
                    />
                  )}
                </li>
              ))}
          </ul>
        )}
      </Card>
    </>
  );
}
