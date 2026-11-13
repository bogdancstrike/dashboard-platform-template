import { DatePicker, Tooltip } from "antd";
import dayjs from "dayjs";

import { humanStatus } from "@/components/StatusTag";
import { absoluteTime, relativeTime } from "@/lib/time";

import type { VersionHistoryModel } from "./useVersionHistory";

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Created",
  UPDATE: "Edited",
  STATUS_CHANGE: "Status changed",
  RESTORE: "Restored",
  BASELINE: "Earliest recorded",
  BULK_UPDATE: "Bulk edit",
};

/** The versions, newest first, with "view as of a date" above them; pressing one makes it A. */
export function VersionList({ model }: { model: VersionHistoryModel }) {
  const { data, asOf, setAsOf, a, b, pick } = model;
  if (!data) return null;
  return (
  <div className="nx-ra-stack">
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <DatePicker
        placeholder="View as of a date"
        value={asOf ? dayjs(asOf) : null}
        onChange={(value) => setAsOf(value ? value.format("YYYY-MM-DD") : null)}
        disabledDate={(day) => day.isAfter(dayjs())}
        aria-label="View as of a date"
        data-testid="versions-as-of"
      />
      {asOf && data.as_of && <span className="nx-ra-pill">Version {data.as_of} was in force</span>}
    </div>
    <ol className="nx-ra-vlist" aria-label="Versions">
      {[...data.versions].reverse().map((version) => (
        <li key={version.id}>
          <button
            type="button"
            className={`nx-ra-vitem${version.number === a ? " is-a" : ""}${version.number === b ? " is-b" : ""}`}
            onClick={() => pick(version)}
            aria-pressed={version.number === a}
            data-testid={`version-${version.number}`}
          >
            <span className="nx-ra-vitem-top">
              <span>
                v{version.number}
                {version.number === data.current ? " · current" : ""}
                {version.number === a ? " · A" : ""}
                {version.number === b ? " · B" : ""}
              </span>
              <Tooltip title={absoluteTime(version.at)}>
                <span>{relativeTime(version.at)}</span>
              </Tooltip>
            </span>
            <b>
              <span className={`nx-ra-vtag${version.action === "RESTORE" ? " is-restore" : ""}`}>
                {ACTION_LABEL[version.action] ?? humanStatus(version.action)}
              </span>{" "}
              {version.actor}
            </b>
            <small>
              {version.action === "RESTORE" && version.restored_from ? `from v${version.restored_from} · ` : ""}
              {version.changed.length ? version.changed.map((name) => data.fields.find((f) => f.name === name)?.label ?? name).join(", ") : version.message}
            </small>
          </button>
        </li>
      ))}
    </ol>
  </div>
  );
}
