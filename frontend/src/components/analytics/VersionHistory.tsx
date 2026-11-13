/**
 * Record version history with point-in-time restore (§17).
 *
 * The list is every version the audit trail can rebuild, newest first. Two
 * of them are compared side by side — pick "A" and "B" — and from the
 * comparison a whole version or single fields can be put back, after a
 * confirmation, by anybody holding the edit permission and `records.restore`.
 * "View as of" jumps to the version in force at a date.
 *
 * Used as a panel on the generic record page's History tab, and as a drawer
 * (URL key `?versions=1`) from the task, project, ticket and contract pages.
 */
import "@/styles/analytics.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Checkbox, DatePicker, Drawer, Grid, Skeleton, Tooltip } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";

import { URL_OVERLAY } from "@/app/history";
import { useUrlOverlay } from "@/app/useUrlOverlay";
import { versionsApi, type RecordVersion, type VersionField, type VersionHistory as History } from "@/api/recordsAnalytics";
import { FailureAlert } from "@/components/FailureAlert";
import { humanStatus } from "@/components/StatusTag";
import { errorText } from "@/lib/errors";
import { absoluteTime, relativeTime } from "@/lib/time";
import { asText } from "@/lib/text";
import { EmptyState } from "@/components/EmptyState";
import { FEATURES, withFeature } from "@/settings/features";

export function displayValue(
  field: VersionField,
  value: unknown,
  references: History["references"],
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.references) {
    const named = references[field.references]?.[asText(value)];
    return named ?? `${asText(value).slice(0, 8)}…`;
  }
  if (field.kind === "bool") return value ? "Yes" : "No";
  if (field.kind === "enum") return humanStatus(asText(value));
  if (field.kind === "datetime") return absoluteTime(asText(value)) || asText(value);
  if (field.kind === "number") return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  return asText(value);
}

const ACTION_LABEL: Record<string, string> = {
  CREATE: "Created",
  UPDATE: "Edited",
  STATUS_CHANGE: "Status changed",
  RESTORE: "Restored",
  BASELINE: "Earliest recorded",
  BULK_UPDATE: "Bulk edit",
};

function VersionHistoryInner({
  resourceType,
  recordId,
  narrow = false,
  onRestored,
}: {
  resourceType: string;
  recordId: string;
  narrow?: boolean;
  onRestored?: () => void;
}) {
  const client = useQueryClient();
  // `modal` from the App context, not the static Modal.confirm: the static one
  // renders outside the theme — default blue, square corners, no dark mode.
  const { message, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const [asOf, setAsOf] = useState<string | null>(null);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const history = useQuery({
    queryKey: ["record-versions", resourceType, recordId, asOf],
    queryFn: ({ signal }) => versionsApi.history(resourceType, recordId, asOf, signal),
  });
  const data = history.data;

  // Default comparison: the version before the newest against the newest, or
  // the as-of version against now.
  useEffect(() => {
    if (!data) return;
    const latest = data.current;
    setB(latest);
    setA(data.as_of ?? Math.max(1, latest - 1));
    setPicked([]);
  }, [data]);

  const left = data?.versions.find((v) => v.number === a);
  const right = data?.versions.find((v) => v.number === b);
  const rows = useMemo(
    () =>
      (data?.fields ?? []).map((field) => {
        const before = left?.state[field.name];
        const after = right?.state[field.name];
        return { field, before, after, differs: JSON.stringify(before) !== JSON.stringify(after) };
      }),
    [data, left, right],
  );
  const differing = rows.filter((row) => row.differs);
  // Restoring puts *version A* back over the record as it is now.
  const target = left;
  const current = data?.versions[data.versions.length - 1];
  const restorable = (data?.fields ?? []).filter(
    (field) => target && current && JSON.stringify(target.state[field.name]) !== JSON.stringify(current.state[field.name]),
  );

  const restore = useMutation({
    mutationFn: (fields?: string[]) =>
      versionsApi.restore(resourceType, recordId, { version: target!.number, fields, expected_updated_at: data?.updated_at }),
    onSuccess: (result) => {
      void message.success(result.message);
      client.setQueryData(["record-versions", resourceType, recordId, null], result.history);
      setAsOf(null);
      void client.invalidateQueries({ queryKey: ["record-versions", resourceType, recordId] });
      void client.invalidateQueries({ queryKey: ["record", resourceType, recordId] });
      void client.invalidateQueries({ queryKey: ["contract", recordId] });
      onRestored?.();
    },
    onError: (error) => void message.error(errorText(error, { action: "restore this record" })),
  });

  const confirm = (fields?: string[]) => {
    if (!target || !data) return;
    const names = (fields ?? restorable.map((f) => f.name))
      .map((name) => data.fields.find((f) => f.name === name)?.label ?? name)
      .join(", ");
    modal.confirm({
      title: fields ? `Restore ${fields.length === 1 ? names : `${fields.length} fields`} from version ${target.number}?` : `Restore version ${target.number}?`,
      content: (
        <span>
          {fields ? `${names} will be set back to how they were` : `Every field that differs (${names || "none"}) will be set back to how it was`}{" "}
          on {absoluteTime(target.at)}. The restore is recorded in the history and can itself be undone.
        </span>
      ),
      okText: "Restore",
      okButtonProps: { "data-testid": "restore-confirm" },
      onOk: () => restore.mutateAsync(fields),
    });
  };

  if (history.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (history.isError) {
    return <FailureAlert error={history.error} onRetry={() => void history.refetch()} titles={{ not_found: "No version that early" }}
      action={asOf ? <Button onClick={() => setAsOf(null)}>Back to now</Button> : undefined} />;
  }
  if (!data || data.versions.length === 0) return <EmptyState title="No history recorded for this record yet" />;

  const pick = (version: RecordVersion) => {
    if (version.number === b) return;
    setA(version.number);
    setPicked([]);
  };
  const stacked = narrow || !screens.lg;

  return (
    <div className={`nx-ra-versions${stacked ? " nx-ra-versions--narrow" : ""}`} data-testid="version-history">
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

      <div className="nx-ra-stack">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="nx-ra-sub">
            Comparing <b>v{a}</b> with <b>v{b}</b> · {differing.length} difference{differing.length === 1 ? "" : "s"}
          </span>
          {data.can_restore && target && target.number !== data.current && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button
                disabled={picked.length === 0}
                loading={restore.isPending && picked.length > 0}
                onClick={() => confirm(picked)}
                data-testid="restore-fields"
              >
                Restore {picked.length || ""} field{picked.length === 1 ? "" : "s"}
              </Button>
              <Button type="primary" disabled={restorable.length === 0} onClick={() => confirm()} data-testid="restore-version">
                Restore v{target.number}
              </Button>
            </div>
          )}
        </div>
        {!data.can_restore && (
          <p className="nx-ra-muted">Restoring needs the edit permission and “Restore earlier versions of records”.</p>
        )}
        <div className="nx-ra-scroll">
          <table className="nx-ra-diff" aria-label="Version comparison">
            <thead>
              <tr>
                <th style={{ width: "28%" }}>Field</th>
                <th>v{a}</th>
                <th style={{ textAlign: "right" }}>v{b}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ field, before, after, differs }) => {
                const canPick = data.can_restore && target?.number !== data.current && restorable.some((f) => f.name === field.name);
                return (
                  <tr key={field.name} className={differs ? "is-diff" : ""} data-testid={`diff-${field.name}`}>
                    <td>
                      {canPick ? (
                        <Checkbox
                          checked={picked.includes(field.name)}
                          onChange={(event) =>
                            setPicked((current) =>
                              event.target.checked ? [...current, field.name] : current.filter((name) => name !== field.name),
                            )
                          }
                          aria-label={`Restore ${field.label}`}
                        >
                          {field.label}
                        </Checkbox>
                      ) : (
                        field.label
                      )}
                    </td>
                    <td className={differs ? "is-old" : ""}>{displayValue(field, before, data.references)}</td>
                    <td className={differs ? "is-new" : ""}>{displayValue(field, after, data.references)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** A button that opens the history as a URL-driven drawer (`?versions=1`). */
function VersionHistoryButtonInner({ resourceType, recordId }: { resourceType: string; recordId: string }) {
  const overlay = useUrlOverlay("versions");
  return (
    <>
      <Button onClick={() => overlay.open("1")} data-testid="open-versions">
        Versions & restore
      </Button>
      <Drawer
        open={overlay.value === "1"}
        onClose={overlay.close}
        title="Version history"
        width="min(980px, 100vw)"
        rootClassName={URL_OVERLAY}
        destroyOnClose
      >
        <VersionHistory resourceType={resourceType} recordId={recordId} />
      </Drawer>
    </>
  );
}

/** Rendered only while its feature flag is on (§27). */
export const VersionHistory = withFeature(FEATURES.versionHistory, VersionHistoryInner);

/** Rendered only while its feature flag is on (§27). */
export const VersionHistoryButton = withFeature(FEATURES.versionHistory, VersionHistoryButtonInner);
