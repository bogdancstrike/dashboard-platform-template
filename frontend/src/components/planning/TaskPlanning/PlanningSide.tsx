import { useMutation, useQuery } from "@tanstack/react-query";
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  InputNumber,
  Select,
  Space,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useState } from "react";

import { apiMessageToast } from "@/lib/errors";
import { planningApi } from "@/api/planning";
import type { RecordPage } from "@/components/records/useRecordPage";
import { asText } from "@/lib/text";
import { relativeTime } from "@/lib/time";

import { PlanIcon } from "@/components/icons/PlanIcon";
import { FEATURES, useFeatures } from "@/settings/features";
import { queryKeys } from "@/lib/queryKeys";

import { PlanningFlags } from "./PlanningFlags";
import { RecurrenceModal } from "./RecurrenceModal";
import { SAVE_FAILED, useRefresh, useTaskPlanning } from "./shared";

/** The side card: points, start, epic, sprint, milestone, flag, cover, watchers, repeat. */
export function TaskPlanningSide({ id, page }: { id: string; page: RecordPage }) {
  const { message } = AntApp.useApp();
  const planning = useTaskPlanning(id);
  const refresh = useRefresh(id);
  const canEdit = Boolean(page.record?.can_edit);
  const [repeating, setRepeating] = useState(false);
  // Sprints and epics, and repeating, are features of their own (§27).
  const features = useFeatures();
  const sprintsOn = features(FEATURES.sprints);
  const recurringOn = features(FEATURES.recurringTasks);
  const projectId = asText(page.value("project_id"));
  const epics = useQuery({
    queryKey: queryKeys.epics(projectId),
    queryFn: ({ signal }) => planningApi.epics({ project_id: projectId || undefined }, signal),
    enabled: sprintsOn,
  });
  const sprints = useQuery({
    queryKey: queryKeys.sprints(projectId),
    queryFn: ({ signal }) => planningApi.sprints({ project_id: projectId || undefined }, signal),
    enabled: sprintsOn,
  });

  const watch = useMutation({
    mutationFn: (on: boolean) => (on ? planningApi.watch(id) : planningApi.unwatch(id)),
    onSuccess: (result) => message.success(result.watching ? "You will hear about changes to this task" : "No longer watching"),
    onError: apiMessageToast(message, SAVE_FAILED),
    onSettled: refresh,
  });
  const plan = useMutation({
    mutationFn: (sprintId: string | null) => planningApi.place({ task_id: id, sprint_id: sprintId, after_id: null, before_id: null }),
    onSuccess: () => message.success("Sprint updated"),
    onError: apiMessageToast(message, SAVE_FAILED),
    onSettled: refresh,
  });

  const data = planning.data;
  const isEpic = asText(page.value("kind")) === "EPIC";

  return (
    <Card size="small" title="Planning" className="nu-block" data-testid="task-planning">
      <div className="nx-pl-facts">
        <div>
          <label htmlFor="task-points">Story points</label>
          <InputNumber
            id="task-points"
            aria-label="Story points"
            min={0}
            max={999}
            style={{ width: "100%" }}
            disabled={!canEdit}
            defaultValue={(page.value("story_points") as number | null) ?? undefined}
            key={`points-${String(page.value("story_points"))}`}
            onBlur={(event) => {
              const raw = event.target.value.trim();
              const next = raw === "" ? null : Number(raw);
              if (next !== (page.value("story_points") ?? null)) page.write({ story_points: next });
            }}
          />
        </div>
        <div>
          <label htmlFor="task-start">Start date</label>
          <DatePicker
            id="task-start"
            aria-label="Start date"
            style={{ width: "100%" }}
            disabled={!canEdit}
            value={page.value("start_date") ? dayjs(asText(page.value("start_date"))) : null}
            onChange={(next: dayjs.Dayjs | null) => page.write({ start_date: next?.format("YYYY-MM-DD") ?? null })}
          />
        </div>
      </div>

      {!isEpic && sprintsOn && (
        <>
          <div className="nx-pl-section-label">Epic</div>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            aria-label="Epic"
            placeholder="No epic"
            style={{ width: "100%" }}
            disabled={!canEdit}
            loading={epics.isLoading}
            value={asText(page.value("epic_id")) || undefined}
            onChange={(next: string | undefined) => page.write({ epic_id: next ?? null })}
            options={(epics.data?.items ?? []).filter((epic) => epic.id !== id).map((epic) => ({ value: epic.id, label: `${epic.reference} · ${epic.title}` }))}
          />
        </>
      )}

      {sprintsOn && (
        <>
          <div className="nx-pl-section-label">Sprint</div>
          <Select
            allowClear
            aria-label="Sprint"
            placeholder="Backlog"
            style={{ width: "100%" }}
            disabled={!data?.can_manage}
            value={data?.sprint?.id}
            onChange={(next: string | undefined) => plan.mutate(next ?? null)}
            options={[
              ...(sprints.data?.items ?? [])
                .filter((sprint) => sprint.state !== "COMPLETED" || sprint.id === data?.sprint?.id)
                .map((sprint) => ({ value: sprint.id, label: `${sprint.name}${sprint.state === "ACTIVE" ? " (running)" : ""}` })),
            ]}
          />
        </>
      )}

      <PlanningFlags page={page} canEdit={canEdit} />

      <div className="nx-pl-section-label">Watchers</div>
      <div className="nx-pl-watchers">
        {(data?.watchers ?? []).map((person) => (
          <Tooltip key={person.id} title={person.name}>
            <span className="nx-pl-who">{person.initials}</span>
          </Tooltip>
        ))}
        <Button
          icon={<PlanIcon name="eye" />}
          loading={watch.isPending}
          onClick={() => watch.mutate(!data?.watching)}
          data-testid="task-watch"
        >
          {data?.watching ? "Stop watching" : "Watch"}
        </Button>
      </div>

      {recurringOn && <div className="nx-pl-section-label">Repeat</div>}
      <Space wrap hidden={!recurringOn}>
        <span data-testid="task-recurrence">{data?.recurrence ? data.recurrence.summary : "Does not repeat"}</span>
        {data?.can_manage && (
          <Button icon={<PlanIcon name="repeat" />} onClick={() => setRepeating(true)} data-testid="task-repeat">
            {data.recurrence ? "Change" : "Repeat…"}
          </Button>
        )}
      </Space>
      {recurringOn && data?.recurrence?.next_run_at && (
        <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
          Next copy {relativeTime(data.recurrence.next_run_at)} · {data.recurrence.occurrences} made so far
        </Typography.Text>
      )}
      {data?.status_changed_at && (
        <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 10 }}>
          In this status since {relativeTime(data.status_changed_at)}
        </Typography.Text>
      )}

      <RecurrenceModal open={repeating} id={id} current={data?.recurrence ?? null} onClose={() => setRepeating(false)} onSaved={refresh} />
    </Card>
  );
}
