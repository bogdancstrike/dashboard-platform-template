import { Col, Row } from "antd";

import { Bucket } from "../parts/Bucket";
import { Cities } from "../parts/Cities";
import type { MapsPageData } from "../useMapsPage";

/** The same answer by country and by city, as tables. */
export function Breakdowns({ page }: { page: MapsPageData }) {
  const { places, drill, openCity, openCountry, answer, reads } = page;
  return (
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
  );
}
