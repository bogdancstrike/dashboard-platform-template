import { Button, Checkbox } from "antd";

import { displayValue } from "./displayValue";
import type { VersionHistoryModel } from "./useVersionHistory";

/** A against B, field by field, with the restore controls for whoever may use them. */
export function VersionDiff({ model }: { model: VersionHistoryModel }) {
  const { data, a, b, picked, setPicked, rows, differing, target, restorable, restore, confirm } = model;
  if (!data) return null;
  return (
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
  );
}
