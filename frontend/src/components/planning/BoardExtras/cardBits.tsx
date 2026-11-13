import { Tooltip } from "antd";

import { type LaneSetting } from "@/api/planning";

import { Points } from "../PlanItem";

/** How long a card has sat in its lane, as Jira's dots: one per few days, red when stale. */
export function ageDots(since: string | null | undefined, now = Date.now()): { dots: number; days: number; stale: boolean } {
  if (!since) return { dots: 0, days: 0, stale: false };
  const days = Math.max(0, Math.floor((now - new Date(since).getTime()) / 86_400_000));
  const dots = days < 2 ? 0 : days < 4 ? 1 : days < 7 ? 2 : days < 14 ? 3 : 4;
  return { dots, days, stale: days >= 14 };
}

export function AgeDots({ since, closed }: { since: string | null | undefined; closed?: boolean }) {
  const { dots, days, stale } = ageDots(since);
  if (closed || dots === 0) return null;
  return (
    <Tooltip title={`In this lane for ${days} days`}>
      <span className={`nx-pl-age${stale ? " is-stale" : ""}`} role="img" aria-label={`${days} days in this lane`} data-testid="card-age">
        {[0, 1, 2, 3].map((index) => (
          <i key={index} className={index < dots ? "is-on" : undefined} />
        ))}
      </span>
    </Tooltip>
  );
}

/** The extra lines on a card: cover, flag, epic, points, checklist. */
export function CardBadges({
  task,
  epicName,
}: {
  task: {
    story_points?: number | null;
    blocked_reason?: string | null;
    checklist?: { done?: boolean }[] | null;
    epic_id?: string | null;
  };
  epicName?: string;
}) {
  const list = Array.isArray(task.checklist) ? task.checklist : [];
  const done = list.filter((item) => item.done).length;
  return (
    <>
      {(task.blocked_reason || epicName) && (
        <span className="nx-pl-chips">
          {task.blocked_reason && (
            <Tooltip title={task.blocked_reason}>
              <span className="nx-pl-flag" data-testid="card-flag">
                ⚑ {task.blocked_reason}
              </span>
            </Tooltip>
          )}
          {epicName && <span className="nx-pl-chip is-epic">{epicName}</span>}
        </span>
      )}
      {(list.length > 0 || task.story_points != null) && (
        <span className="nu-task-meta">
          {list.length > 0 && (
            <span aria-label={`Checklist ${done} of ${list.length}`} data-testid="card-checklist">
              ☑ {done}/{list.length}
            </span>
          )}
          <span className="nx-rec-spacer" />
          {task.story_points != null && <Points value={Number(task.story_points)} />}
        </span>
      )}
    </>
  );
}

/** "3 / 4" beside a lane name; red when over the limit. */
export function WipBadge({ count, setting }: { count: number; setting?: LaneSetting }) {
  if (!setting?.wip_limit) return null;
  const over = count > setting.wip_limit;
  return (
    <Tooltip title={over ? `Over its work-in-progress limit of ${setting.wip_limit}` : `Limit ${setting.wip_limit}`}>
      <span className={`nx-pl-wip${over ? " is-over" : ""}`} data-testid={`wip-${setting.status}`}>
        {count}/{setting.wip_limit}
      </span>
    </Tooltip>
  );
}
