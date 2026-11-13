import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Grid } from "antd";
import { useEffect, useMemo, useState } from "react";

import { versionsApi, type RecordVersion } from "@/api/recordsAnalytics";
import { errorToast } from "@/lib/errors";
import { absoluteTime } from "@/lib/time";
import { queryKeys } from "@/lib/queryKeys";

/**
 * The history's state: which date it is viewed as of, which two versions are
 * compared (A against B), which fields are ticked, and restoring — a whole
 * version or the ticked fields — after a confirmation.
 */
export function useVersionHistory(resourceType: string, recordId: string, onRestored?: () => void) {
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
    queryKey: queryKeys.recordVersions(resourceType, recordId, asOf),
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
      client.setQueryData(queryKeys.recordVersions(resourceType, recordId, null), result.history);
      setAsOf(null);
      void client.invalidateQueries({ queryKey: queryKeys.recordVersions(resourceType, recordId) });
      void client.invalidateQueries({ queryKey: queryKeys.record(resourceType, recordId) });
      void client.invalidateQueries({ queryKey: queryKeys.contract(recordId) });
      onRestored?.();
    },
    onError: errorToast(message, { action: "restore this record" }),
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

  const pick = (version: RecordVersion) => {
    if (version.number === b) return;
    setA(version.number);
    setPicked([]);
  };

  return {
    history, data, asOf, setAsOf, a, b, picked, setPicked, rows, differing, target, restorable, restore, confirm, pick,
    screens,
  };
}

export type VersionHistoryModel = ReturnType<typeof useVersionHistory>;
