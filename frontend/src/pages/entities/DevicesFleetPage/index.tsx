/**
 * Devices as a fleet monitor (§7, §65).
 *
 * Hardware is watched, not browsed. The questions are "what is down", "what is
 * about to be" and "what have I not heard from" — and all three are about the
 * fleet rather than about any one device, so the page leads with the fleet and
 * lets somebody drill into a unit.
 *
 * Every tile carries **two** health signals, battery and signal strength, drawn
 * as bars rather than printed as numbers: a wall of forty devices is scanned,
 * and a scan reads length far faster than it reads digits. Staleness gets its
 * own colour because a device that has not reported in a week is a different
 * problem from one reporting that it is unwell.
 */

import { Skeleton } from "antd";

import { NewRecordButton } from "@/components/records/useRecordEditing";
import { usePageCommands } from "@/commands/CommandContext";
import {
  EntityEmpty,
  EntityError,
  EntityFilters,
  EntityHeader,
  MetricStrip,
} from "@/entities/EntityChrome";
import { EntityPager, useEntityList } from "@/entities/list";

import { DeviceCard } from "./DeviceCard";
import { FleetSummary } from "./FleetSummary";
import { COLUMNS, type DeviceRow } from "./types";

export default function DevicesFleetPage() {
  const { view, rows, records } = useEntityList<DeviceRow>("device", "/devices", {
    columns: COLUMNS,
    defaultSort: "last_seen_at",
    defaultPageSize: 36,
  });

  usePageCommands("entity:device", [
    {
      id: "device.new",
      label: "Register a device",
      keywords: "new add create enrol",
      run: records.create,
    },
    {
      id: "device.offline",
      label: "Show devices that are offline",
      keywords: "down dead unreachable",
      run: () => view.setFilter("status", "OFFLINE"),
    },
    {
      id: "device.degraded",
      label: "Show degraded devices",
      keywords: "unhealthy warning",
      run: () => view.setFilter("status", "DEGRADED"),
    },
  ]);

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="The fleet at a glance — what is up, what is unwell, and what has stopped talking."
        actions={<NewRecordButton records={records} resource={view.resource} />}
      />

      <MetricStrip view={view} accents={["accent", "success", "warning", "danger"]} />
      <FleetSummary view={view} />

      <EntityFilters view={view} only={["status", "kind", "manufacturer", "location"]} />
      <EntityError view={view} />

      {view.rows.isLoading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : rows.length === 0 ? (
        <EntityEmpty
          view={view}
          card
          title="No devices in the fleet yet"
          hint="A device reports its health and its last contact."
          action={<NewRecordButton records={records} resource={view.resource} />}
        />
      ) : (
        <div className="nu-fleet" data-testid="device-fleet">
          {rows.map((device) => (
            <DeviceCard key={device.id} device={device} records={records} />
          ))}
        </div>
      )}

      {records.drawer}
      <EntityPager view={view} defaultPageSize={36} pageSizeOptions={[18, 36, 72, 144]} />
    </>
  );
}
