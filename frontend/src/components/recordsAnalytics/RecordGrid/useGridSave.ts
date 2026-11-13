import { App } from "antd";

import { gridApi } from "@/api/recordsAnalytics";
import { errorText } from "@/lib/errors";
import { emptyHistory, savable } from "@/lib/gridSheet";

import type { GridModel } from "./useGridModel";

/**
 * Saving: one change set per row through the records bulk API; applied cells
 * flash, refused ones keep the server's reason.
 */
export function useGridSave(model: GridModel, resourceType: string, onSaved?: () => void) {
  const { message } = App.useApp();
  const { rows, setRows, pending, setPending, setHistory, setSaved, saving, setSaving } = model;

  async function save() {
    const batch = savable(pending);
    if (!batch.length || saving) return;
    setSaving(true);
    try {
      const updatedAt = new Map(rows.map((row) => [row.id, row.updated_at as string | undefined]));
      const result = await gridApi.save(
        resourceType,
        batch.map((row) => ({ ...row, expected_updated_at: updatedAt.get(row.id) ?? null })),
      );
      const flashed = new Set<string>();
      const next = { ...pending };
      const byId = new Map(result.results.map((r) => [r.id, r]));
      setRows((current) =>
        current.map((row) => {
          const outcome = byId.get(row.id);
          const sent = batch.find((b) => b.id === row.id);
          if (!outcome || !sent || outcome.status === "failed") return row;
          return { ...row, ...sent.changes, ...(outcome.updated_at ? { updated_at: outcome.updated_at } : {}) };
        }),
      );
      for (const sent of batch) {
        const outcome = byId.get(sent.id);
        if (!outcome) continue;
        const fields = { ...(next[sent.id] ?? {}) };
        if (outcome.status === "failed") {
          const problems = new Map(outcome.problems.map((p) => [p.field, p.message]));
          for (const field of Object.keys(sent.changes)) {
            const reason = problems.get(field) ?? (outcome.problems.length ? undefined : outcome.message);
            if (reason) fields[field] = { ...fields[field]!, error: reason };
          }
        } else {
          for (const field of Object.keys(sent.changes)) {
            delete fields[field];
            flashed.add(`${sent.id}:${field}`);
          }
        }
        if (Object.keys(fields).length) next[sent.id] = fields;
        else delete next[sent.id];
      }
      setPending(next);
      setHistory(emptyHistory);
      setSaved(flashed);
      window.setTimeout(() => setSaved(new Set()), 1400);
      if (result.failed.length) void message.warning(result.message);
      else void message.success(result.message);
      onSaved?.();
    } catch (error) {
      void message.error(errorText(error, { action: "edit these records" }));
    } finally {
      setSaving(false);
    }
  }

  return save;
}
