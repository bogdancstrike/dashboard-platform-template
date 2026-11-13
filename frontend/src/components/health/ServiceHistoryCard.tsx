/**
 * One dependency, across a window of time (§24).
 *
 * The health page could only say what was true *now*, which is the question a
 * deploy pipeline asks. The question a person on this page is almost always
 * asking is the other one — **was it working at four o'clock**, when the thing
 * they are investigating happened — and a page that cannot answer it leaves
 * the incident to be reconstructed from memory.
 *
 * Four decisions worth stating.
 *
 * **Latency is the line; status is the ground under it.** Drawing status as a
 * second line would put two unrelated scales on one axis. Painting it as a
 * band under the latency says the two things a reader needs at once: how slow
 * it was, and whether anybody would have noticed.
 *
 * **An outage is a period, not a run of points.** "Unavailable at 04:00, 05:00
 * and 06:00" is one incident, and listing it three times makes an outage look
 * like three. The server collapses consecutive not-healthy points; this draws
 * what it collapsed.
 *
 * **Two uptime numbers, both named.** The row carries a lifetime figure and
 * the window has its own, and they are usually different. Showing one of them
 * unlabelled is how a number gets quoted wrongly in a report.
 *
 * **The card is a summary; the detail is one press away.** A 340-pixel card
 * can carry the shape of the window and the last few periods of trouble, in
 * short day-named times. Everything else — the full axis, every period, the
 * band with a tooltip per reading — opens in a large dialog, so the grid stays
 * a grid of cards of one height rather than a column of charts.
 */

import { Modal, Tooltip, Typography } from "antd";
import { type KeyboardEvent } from "react";

import { URL_OVERLAY } from "@/app/history";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";

import type { HealthIncident, HealthPoint, ServiceHistory } from "@/api/meta";
import { EmptyState } from "@/components/EmptyState";
import { absoluteTime } from "@/lib/time";
import { statusColor } from "@/theme/tokens";

import { LatencyChart } from "./LatencyChart";
import { ago, latency, shortRange, shortWhen } from "./when";

const { Text } = Typography;

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

function Uptime({ service }: { service: ServiceHistory }) {
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

function Checked({ at }: { at: string | null }) {
  if (!at) return null;
  return (
    <Tooltip title={absoluteTime(at)}>
      <span className="nx-hl-checked">checked {ago(at)}</span>
    </Tooltip>
  );
}

/** The status band: one segment per reading, each with its own tooltip. */
function Band({ service, points, tall = false }: { service: ServiceHistory; points: HealthPoint[]; tall?: boolean }) {
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

function IncidentRow({ incident }: { incident: HealthIncident }) {
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

export function ServiceHistoryCard({ service }: { service: ServiceHistory }) {
  // In the address (`?service=postgres`), pushed: back closes the dialog, and
  // a link to it opens it.
  const overlay = useUrlOverlay("service");
  const open = overlay.value === service.key;
  const setOpen = (next: boolean) => (next ? overlay.open(service.key) : overlay.close());
  const points = service.series;
  const latest = points[points.length - 1];

  const onKey = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <>
      <section
        className="nu-health-service nx-hl-card"
        data-testid={`health-${service.key}`}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-label={`${service.name}: open its history`}
        onClick={() => setOpen(true)}
        onKeyDown={onKey}
      >
        <header className="nu-health-head">
          <span className="nu-health-name">
            <span className="nu-health-dot" style={{ background: statusColor(service.status) }} aria-hidden />
            <Text strong>{service.name}</Text>
            <Text type="secondary" className="nu-health-category">
              {service.category.toLowerCase()}
            </Text>
          </span>
          {latest && <span className="nx-hl-now">{latency(latest.latency_ms)}</span>}
        </header>

        <div className="nx-hl-meta">
          <Uptime service={service} />
          <Checked at={service.last_checked_at} />
        </div>

        {points.length === 0 ? (
          <EmptyState compact title="Nothing recorded in this window" />
        ) : (
          <>
            <LatencyChart
              points={points}
              height={96}
              label={`${service.name}: latency across the window, ${points.length} readings`}
            />
            <Band service={service} points={points} />
            <div className="nx-hl-bandaxis">
              <span>{shortWhen(points[0]!.at)}</span>
              <span>{shortWhen(points[points.length - 1]!.at)}</span>
            </div>
          </>
        )}

        <div className="nx-hl-foot">
          {service.incidents.length > 0 ? (
            <ul className="nu-health-incidents nx-hl-incidents">
              {service.incidents.slice(0, 2).map((incident) => (
                <IncidentRow key={`${incident.status}-${incident.started_at}`} incident={incident} />
              ))}
              {service.incidents.length > 2 && (
                <li className="nx-hl-more">and {service.incidents.length - 2} more in this window</li>
              )}
            </ul>
          ) : (
            <span className="nx-hl-calm">No trouble in this window</span>
          )}
          {service.message && <Text type="secondary" className="nu-health-message">{service.message}</Text>}
        </div>
      </section>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={1040}
        rootClassName={URL_OVERLAY}
        centered
        destroyOnClose
        className="nx-hl-modal"
        title={
          <span className="nx-hl-modal-title">
            <span className="nu-health-dot" style={{ background: statusColor(service.status) }} aria-hidden />
            {service.name}
            <small>{service.category.toLowerCase()} · {service.status.toLowerCase()}</small>
          </span>
        }
      >
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
              <span>{service.last_checked_at ? absoluteTime(service.last_checked_at) : "never checked"}</span>
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
              <div className="nx-hl-bandaxis">
                <span>{shortWhen(points[0]!.at)}</span>
                <span>{shortWhen(points[points.length - 1]!.at)}</span>
              </div>
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
                  <span className={`nx-hl-pill ${incident.status === "UNAVAILABLE" ? "is-bad" : "is-warn"}`}>
                    {incident.status.toLowerCase()}
                  </span>
                  <span className="nx-hl-range">{shortRange(incident.started_at, incident.ended_at)}</span>
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
      </Modal>
    </>
  );
}
