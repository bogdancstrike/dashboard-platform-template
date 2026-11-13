import { Typography } from "antd";

import type { ServiceHistory } from "@/api/meta";
import { EmptyState } from "@/components/EmptyState";
import { absoluteTime } from "@/lib/time";

import { LatencyChart } from "./LatencyChart";
import { BandAxis, Band, lasted } from "./serviceParts";
import { ago, latency, shortRange } from "./when";

const { Text } = Typography;

/** Everything about one service in the window: the figures, the full axis, every period of trouble. */
export function ServiceHistoryDetail({ service }: { service: ServiceHistory }) {
  const points = service.series;
  const latest = points[points.length - 1];
  return (
    <div className="nx-hl-detail" data-testid={`health-detail-${service.key}`}>
      <div className="nx-hl-stats">
        <div>
          <small>In view</small>
          <b>{service.window_uptime_percent}%</b>
          <span>healthy checks in this window</span>
        </div>
        <div>
          <small>Lifetime</small>
          <b>{service.uptime_percent}%</b>
          <span>recorded against the service</span>
        </div>
        <div>
          <small>Latency now</small>
          <b>{latest ? latency(latest.latency_ms) : "—"}</b>
          <span>{points.length} readings in view</span>
        </div>
        <div>
          <small>Last check</small>
          <b>{ago(service.last_checked_at)}</b>
          <span>
            {service.last_checked_at ? absoluteTime(service.last_checked_at) : "never checked"}
          </span>
        </div>
      </div>

      {points.length === 0 ? (
        <EmptyState title="Nothing recorded in this window" />
      ) : (
        <>
          <h4 className="nx-hl-h">Latency</h4>
          <LatencyChart
            points={points}
            incidents={service.incidents}
            height={300}
            detailed
            label={`${service.name}: latency across the window, ${points.length} readings`}
          />
          <h4 className="nx-hl-h">Status, reading by reading</h4>
          <Band service={service} points={points} tall />
          <BandAxis points={points} />
        </>
      )}

      <h4 className="nx-hl-h">
        Periods of trouble <span>{service.incidents.length}</span>
      </h4>
      {service.incidents.length === 0 ? (
        <Text type="secondary">Nothing went wrong in this window.</Text>
      ) : (
        <ul className="nx-hl-list">
          {service.incidents.map((incident) => (
            <li key={`${incident.status}-${incident.started_at}`}>
              <span
                className={`nx-hl-pill ${incident.status === "UNAVAILABLE" ? "is-bad" : "is-warn"}`}
              >
                {incident.status.toLowerCase()}
              </span>
              <span className="nx-hl-range">
                {shortRange(incident.started_at, incident.ended_at)}
              </span>
              <span className="nx-hl-lasted">{lasted(incident)}</span>
              <span className="nx-hl-exact">
                {absoluteTime(incident.started_at)} — {absoluteTime(incident.ended_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {service.message && <p className="nx-hl-message">{service.message}</p>}
    </div>
  );
}
