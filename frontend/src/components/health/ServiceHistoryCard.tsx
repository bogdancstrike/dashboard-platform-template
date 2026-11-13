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

import { Modal, Typography } from "antd";
import { type KeyboardEvent } from "react";

import { URL_OVERLAY } from "@/app/history";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";

import type { ServiceHistory } from "@/api/meta";
import { EmptyState } from "@/components/EmptyState";
import { statusColor } from "@/theme/tokens";

import { LatencyChart } from "./LatencyChart";
import { BandAxis, Band, Checked, IncidentRow, Uptime } from "./serviceParts";
import { ServiceHistoryDetail } from "./ServiceHistoryDetail";
import { latency } from "./when";

const { Text } = Typography;

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
            <span
              className="nu-health-dot"
              style={{ background: statusColor(service.status) }}
              aria-hidden
            />
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
            <BandAxis points={points} />
          </>
        )}

        <div className="nx-hl-foot">
          {service.incidents.length > 0 ? (
            <ul className="nu-health-incidents nx-hl-incidents">
              {service.incidents.slice(0, 2).map((incident) => (
                <IncidentRow
                  key={`${incident.status}-${incident.started_at}`}
                  incident={incident}
                />
              ))}
              {service.incidents.length > 2 && (
                <li className="nx-hl-more">
                  and {service.incidents.length - 2} more in this window
                </li>
              )}
            </ul>
          ) : (
            <span className="nx-hl-calm">No trouble in this window</span>
          )}
          {service.message && (
            <Text type="secondary" className="nu-health-message">
              {service.message}
            </Text>
          )}
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
            <span
              className="nu-health-dot"
              style={{ background: statusColor(service.status) }}
              aria-hidden
            />
            {service.name}
            <small>
              {service.category.toLowerCase()} · {service.status.toLowerCase()}
            </small>
          </span>
        }
      >
        <ServiceHistoryDetail service={service} />
      </Modal>
    </>
  );
}
