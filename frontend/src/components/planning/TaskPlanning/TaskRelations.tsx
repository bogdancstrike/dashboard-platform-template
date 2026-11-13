import { useMutation, useQuery } from "@tanstack/react-query";
import { App as AntApp, Button, Card, Input, Select, Space, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useState } from "react";
import { Link } from "react-router-dom";

import { apiMessage, apiMessageToast } from "@/lib/errors";
import { planningApi, type PlanBrief } from "@/api/planning";
import { recordsApi } from "@/api/records";
import { StatusTag } from "@/components/StatusTag";
import type { RecordPage } from "@/components/records/useRecordPage";
import { asText } from "@/lib/text";

import { KindBadge, Points } from "../PlanItem";
import { PlanIcon } from "@/components/icons/PlanIcon";
import { shortDate } from "../gantt";
import { FEATURES, useFeature } from "@/settings/features";
import { queryKeys } from "@/lib/queryKeys";

import { SAVE_FAILED, useRefresh, useTaskPlanning } from "./shared";

export function Related({ items, onRemove, empty }: { items: (PlanBrief & { dependency_id?: string })[]; onRemove?: (item: PlanBrief & { dependency_id?: string }) => void; empty: string }) {
  if (items.length === 0) return <Typography.Text type="secondary">{empty}</Typography.Text>;
  return (
    <ul className="nx-pl-links-list">
      {items.map((item) => (
        <li key={item.dependency_id ?? item.id}>
          <KindBadge kind={item.kind} />
          <span className="nx-pl-ref">{item.reference}</span>
          <Link to={`/tasks/${item.id}`}>{item.title}</Link>
          {item.end && <span className="nx-pl-chip">{shortDate(item.end)}</span>}
          <StatusTag status={item.status} />
          <Points value={item.story_points} />
          {onRemove && (
            <Button type="text" icon={<DeleteOutlined />} aria-label={`Remove ${item.reference}`} onClick={() => onRemove(item)} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Subtasks (and, for an epic, its stories) and what this waits on / holds up. */
export function TaskRelations({ id, page }: { id: string; page: RecordPage }) {
  const { message, modal } = AntApp.useApp();
  const planning = useTaskPlanning(id);
  const refresh = useRefresh(id);
  const [title, setTitle] = useState("");
  const [waitOn, setWaitOn] = useState<string | undefined>();
  const canEdit = Boolean(page.record?.can_edit);
  const data = planning.data;
  const timelineOn = useFeature(FEATURES.timeline);

  const addSubtask = useMutation({
    mutationFn: (text: string) =>
      recordsApi.create("task", {
        title: text,
        parent_id: id,
        project_id: asText(page.value("project_id")) || null,
        epic_id: asText(page.value("epic_id")) || null,
        status: "NEW",
      }),
    onSuccess: () => {
      setTitle("");
      message.success("Subtask added");
    },
    onError: apiMessageToast(message, SAVE_FAILED),
    onSettled: refresh,
  });
  const link = useMutation({
    mutationFn: (predecessor: string) => planningApi.link({ predecessor_id: predecessor, successor_id: id }),
    onSuccess: (created) => {
      setWaitOn(undefined);
      message[created.violated ? "warning" : "success"](
        created.violated ? "Linked — but this task starts before that one ends. See the timeline." : "Dependency added",
      );
    },
    onError: apiMessageToast(message, SAVE_FAILED),
    onSettled: refresh,
  });
  const unlink = (item: PlanBrief & { dependency_id?: string }) =>
    modal.confirm({
      title: `Remove the dependency on ${item.reference}?`,
      okText: "Remove",
      okButtonProps: { danger: true },
      onOk: () =>
        planningApi
          .unlink(item.dependency_id!)
          .then(() => message.success("Dependency removed"))
          .catch((error: unknown) => message.error(apiMessage(error, SAVE_FAILED)))
          .finally(refresh),
    });

  const candidates = useQuery({
    queryKey: queryKeys.timelineCandidates(asText(page.value("project_id"))),
    queryFn: ({ signal }) =>
      planningApi.timeline({ project_id: asText(page.value("project_id")) || undefined, group: "project" }, signal),
    enabled: canEdit && Boolean(page.value("project_id")),
  });
  const options = (candidates.data?.groups ?? [])
    .flatMap((group) => group.items)
    .filter((bar) => bar.id !== id && !data?.blocked_by.some((item) => item.id === bar.id))
    .map((bar) => ({ value: bar.id, label: `${bar.reference} · ${bar.title}` }));

  const total = data?.subtasks.length ?? 0;
  const done = data?.subtasks.filter((item) => item.status === "DONE").length ?? 0;

  return (
    <>
      {data?.children && data.children.length > 0 && (
        <Card size="small" className="nu-block" title={<Space>Work in this epic <Tag>{data.children_done} of {data.children.length} done</Tag></Space>}>
          <Related items={data.children} empty="" />
        </Card>
      )}
      <Card
        size="small"
        className="nu-block"
        data-testid="task-subtasks"
        title={
          <Space size={8}>
            <span>Subtasks</span>
            {total > 0 && <Typography.Text type="secondary">{done} of {total}</Typography.Text>}
          </Space>
        }
        extra={data?.parent ? <Link to={`/tasks/${data.parent.id}`}>Parent: {data.parent.reference}</Link> : undefined}
      >
        <Related items={data?.subtasks ?? []} empty="No subtasks." />
        {canEdit && (
          <Space.Compact style={{ width: "100%", marginTop: 10 }}>
            <Input
              aria-label="New subtask"
              placeholder="Add a subtask"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onPressEnter={() => title.trim() && addSubtask.mutate(title.trim())}
            />
            <Button icon={<PlusOutlined />} disabled={!title.trim()} loading={addSubtask.isPending} onClick={() => addSubtask.mutate(title.trim())}>
              Add
            </Button>
          </Space.Compact>
        )}
      </Card>
      {timelineOn && (
      <Card size="small" className="nu-block" title="Dependencies" data-testid="task-dependencies">
        <div className="nx-pl-section-label" style={{ marginTop: 0 }}>
          Waits on
        </div>
        <Related items={data?.blocked_by ?? []} onRemove={canEdit ? unlink : undefined} empty="Nothing — it can start any time." />
        <div className="nx-pl-section-label">Holds up</div>
        <Related items={data?.blocking ?? []} onRemove={canEdit ? unlink : undefined} empty="Nothing waits on this." />
        {canEdit && page.value("project_id") ? (
          <Space.Compact style={{ width: "100%", marginTop: 10 }}>
            <Select
              showSearch
              optionFilterProp="label"
              aria-label="Waits on"
              placeholder="Make this wait on…"
              style={{ width: "100%" }}
              value={waitOn}
              loading={candidates.isLoading}
              onChange={setWaitOn}
              options={options}
            />
            <Button icon={<PlanIcon name="link" />} disabled={!waitOn} loading={link.isPending} onClick={() => waitOn && link.mutate(waitOn)}>
              Link
            </Button>
          </Space.Compact>
        ) : null}
      </Card>
      )}
    </>
  );
}
