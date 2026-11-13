/** The pieces a service's card and its detail dialog share. */

import { Tooltip } from "antd";

import type { HealthIncident, HealthPoint, ServiceHistory } from "@/api/meta";
import { absoluteTime } from "@/lib/time";
import { statusColor } from "@/theme/tokens";

import { ago, latency, shortRange, shortWhen } from "./when";

/** How long a period of trouble lasted, as a reader would say it. */
export function lasted(incident: HealthIncident): string {
  const minutes = Math.round(
    (new Date(incident.ended_at).valueOf() - new Date(incident.started_at).valueOf()) / 60_000,
  );
  if (minutes <= 0) return `${incident.points} ${incident.points === 1 ? "reading" : "readings"}`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function Uptime({ service }: { service: ServiceHistory }) {
  return (
    <span className="nx-hl-uptime">
      {/* Named, because the row's lifetime figure and the window's are
          usually different and an unlabelled one gets quoted wrongly. */}
      <Tooltip title="Healthy checks in the window you are looking at">
        <span className={`nx-hl-chip ${service.window_uptime_percent >= 99 ? "is-ok" : "is-warn"}`}>
          {service.window_uptime_percent}% in view
        </span>
      </Tooltip>
      <Tooltip title="The figure recorded against the service itself, over its lifetime">
        <span className="nx-hl-chip">{service.uptime_percent}% lifetime</span>
      </Tooltip>
    </span>
  );
}

export function Checked({ at }: { at: string | null }) {
  if (!at) return null;
  return (
    <Tooltip title={absoluteTime(at)}>
      <span className="nx-hl-checked">checked {ago(at)}</span>
    </Tooltip>
  );
}

/** The status band: one segment per reading, each with its own tooltip. */
export function Band({
  service,
  points,
  tall = false,
}: {
  service: ServiceHistory;
  points: HealthPoint[];
  tall?: boolean;
}) {
  return (
    <div
      className={`nu-health-band nx-hl-band${tall ? " nx-hl-band--tall" : ""}`}
      role="img"
      aria-label={`${service.name}: ${service.incidents.length} periods of trouble in this window`}
    >
      {points.map((point) => (
        <Tooltip
          key={point.at}
          title={`${shortWhen(point.at)} · ${point.status.toLowerCase()} · ${latency(point.latency_ms)}`}
        >
          <span className="nu-health-tick" style={{ background: statusColor(point.status) }} />
        </Tooltip>
      ))}
    </div>
  );
}

export function IncidentRow({ incident }: { incident: HealthIncident }) {
  return (
    <li className="nx-hl-incident">
      <span className={`nx-hl-pill ${incident.status === "UNAVAILABLE" ? "is-bad" : "is-warn"}`}>
        {incident.status.toLowerCase()}
      </span>
      <Tooltip title={`${absoluteTime(incident.started_at)} — ${absoluteTime(incident.ended_at)}`}>
        <span className="nx-hl-range">{shortRange(incident.started_at, incident.ended_at)}</span>
      </Tooltip>
    </li>
  );
}

/** The first and last reading's times, under a band. */
export function BandAxis({ points }: { points: HealthPoint[] }) {
  return (
    <div className="nx-hl-bandaxis">
      <span>{shortWhen(points[0]!.at)}</span>
      <span>{shortWhen(points[points.length - 1]!.at)}</span>
    </div>
  );
}
