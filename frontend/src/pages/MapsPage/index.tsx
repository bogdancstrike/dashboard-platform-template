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

import { Alert, Skeleton } from "antd";

import { ApiError } from "@/api/client";
import { PageHeader } from "@/components/PageHeader";
import { formatNumber } from "@/lib/formats";
import { apiErrorDetails } from "@/components/feedback/apiErrorDetails";

import { Breakdowns } from "./parts/Breakdowns";
import { MapCard } from "./parts/MapCard";
import { MapControls } from "./parts/MapControls";
import { PlacesCard } from "./parts/PlacesCard";
import { useMapsPage } from "./useMapsPage";

export default function MapsPage() {
  const page = useMapsPage();
  const { catalogue, chosen, places, answer, unplaced } = page;
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
          description={apiErrorDetails(api)}
        />
      </>
    );
  }

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

      <MapControls page={page} />

      <div className="nx-ov-mapwrap">
        <MapCard page={page} />

        <PlacesCard page={page} />
      </div>

      {unplaced > 0 && (
        <Alert
          className="nu-block"
          type="info"
          showIcon
          message={`${formatNumber(unplaced)} of ${formatNumber(answer?.total ?? 0)} could not be placed`}
          description="They name somewhere the gazetteer does not know, or no place at all. They are counted in the total above and drawn nowhere — so the map and the list agree about how many records there are."
        />
      )}

      <Breakdowns page={page} />
    </>
  );
}
