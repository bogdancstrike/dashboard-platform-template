import { Select } from "antd";

import { PeoplePicker } from "@/components/PeoplePicker";

import { Field } from "@/entities/detail";

import type { CardDrawerModel } from "./useCardDrawer";

/** Lane, priority, assignee, points, parent and labels — each written as soon as it changes. */
export function CardFields({ model, priorities }: { model: CardDrawerModel; priorities: string[] }) {
  const { detail, canEdit, write, relocate } = model;
  if (!detail) return null;
  return (
    <div className="nu-card-drawer-grid">
      <Field label="Lane">
        <Select
          aria-label="Lane"
          style={{ width: "100%" }}
          value={detail.lane_id ?? undefined}
          disabled={!canEdit}
          loading={relocate.isPending}
          onChange={(next: string) => relocate.mutate(next)}
          options={detail.lanes.map((lane) => ({
            value: lane.id,
            label: lane.is_done ? `${lane.name} · done` : lane.name,
          }))}
        />
      </Field>

      <Field label="Priority">
        <Select
          aria-label="Priority"
          style={{ width: "100%" }}
          value={detail.priority}
          disabled={!canEdit}
          onChange={(next: string) => write.mutate({ priority: next })}
          options={priorities.map((item) => ({
            value: item,
            label: item.charAt(0) + item.slice(1).toLowerCase(),
          }))}
        />
      </Field>

      <Field label="Assignee">
        <PeoplePicker
          multiple={false}
          aria-label="Assignee"
          placeholder="Unassigned"
          disabled={!canEdit}
          value={detail.assignee.id ? [detail.assignee.id] : []}
          onChange={(ids) => write.mutate({ assignee_id: ids[0] ?? null })}
        />
      </Field>

      <Field label="Points">
        <Select
          aria-label="Points"
          style={{ width: "100%" }}
          allowClear
          placeholder="Not estimated"
          value={detail.story_points ?? undefined}
          disabled={!canEdit}
          onChange={(next: number | undefined) =>
            write.mutate({ story_points: next ?? null })
          }
          options={[1, 2, 3, 5, 8, 13, 21].map((item) => ({
            value: item,
            label: String(item),
          }))}
        />
      </Field>

      {/* Only offered when the hierarchy permits one — the options come
          from the server's own rule (§76). */}
      {detail.parent_options.length > 0 && (
        <Field label={detail.kind === "STORY" ? "Epic" : "Story"}>
          <Select
            aria-label="Parent"
            style={{ width: "100%" }}
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Not under anything"
            value={detail.parent_id ?? undefined}
            disabled={!canEdit}
            onChange={(next: string | undefined) =>
              write.mutate({ parent_id: next ?? null })
            }
            options={detail.parent_options.map((option) => ({
              value: option.id,
              label: `${option.reference} ${option.title}`,
            }))}
          />
        </Field>
      )}

      <Field label="Labels">
        <Select
          mode="tags"
          aria-label="Labels"
          style={{ width: "100%" }}
          placeholder="None"
          value={detail.labels}
          disabled={!canEdit}
          onChange={(next: string[]) => write.mutate({ labels: next })}
        />
      </Field>
    </div>
  );
}
