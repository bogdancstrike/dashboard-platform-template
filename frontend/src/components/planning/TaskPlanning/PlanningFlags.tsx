import { Input, Space, Switch } from "antd";

import type { RecordPage } from "@/components/records/useRecordPage";
import { asText } from "@/lib/text";

import { COVERS } from "./shared";

/** Blocked (and why), milestone, and the card's cover colour — all fields on the task itself. */
export function PlanningFlags({ page, canEdit }: { page: RecordPage; canEdit: boolean }) {
  const blocked = asText(page.value("blocked_reason"));
  const cover = asText(page.value("cover_color"));
  return (
    <>
      <div className="nx-pl-section-label">Flag</div>
      <Space direction="vertical" style={{ width: "100%" }} size={6}>
        <Space size={8}>
          <Switch
            size="small"
            aria-label="Flag as blocked"
            checked={Boolean(blocked)}
            disabled={!canEdit}
            onChange={(on) => page.write({ blocked_reason: on ? "Blocked" : null })}
            data-testid="task-flag"
          />
          <span>{blocked ? "Blocked" : "Not blocked"}</span>
        </Space>
        {blocked && (
          <Input
            aria-label="Why it is blocked"
            defaultValue={blocked}
            key={`blocked-${blocked}`}
            disabled={!canEdit}
            maxLength={240}
            onBlur={(event) => {
              const reason = event.target.value.trim();
              if (reason && reason !== blocked) page.write({ blocked_reason: reason });
            }}
          />
        )}
        <Space size={8}>
          <Switch
            size="small"
            aria-label="Milestone"
            checked={Boolean(page.value("is_milestone"))}
            disabled={!canEdit}
            onChange={(on) => page.write({ is_milestone: on })}
          />
          <span>Milestone on the timeline</span>
        </Space>
      </Space>

      <div className="nx-pl-section-label">Card cover</div>
      <div className="nx-pl-swatches" role="group" aria-label="Card cover colour">
        <button type="button" className="nx-pl-swatch is-none" aria-label="No cover" aria-pressed={!cover} disabled={!canEdit} onClick={() => page.write({ cover_color: null })} />
        {COVERS.map((colour) => (
          <button
            key={colour}
            type="button"
            className="nx-pl-swatch"
            style={{ ["--nx-pl-tone" as string]: colour }}
            aria-label={`Cover ${colour}`}
            aria-pressed={cover === colour}
            disabled={!canEdit}
            onClick={() => page.write({ cover_color: colour })}
          />
        ))}
      </div>
    </>
  );
}
