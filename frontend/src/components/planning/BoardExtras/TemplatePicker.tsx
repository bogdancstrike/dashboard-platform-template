import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Input, Modal, Select, Space, Typography } from "antd";
import { useState } from "react";

import { planningApi, type TaskTemplate } from "@/api/planning";
import { refreshRecordViews } from "@/lib/refresh";

import { projectOptions, useProjects } from "../useProjects";
import { FEATURES, withFeature } from "@/settings/features";
import { queryKeys } from "@/lib/queryKeys";
import { apiMessageToast } from "@/lib/errors";

/** Pick a template, name the copy, choose the project — and the task exists. */
export function TemplatePickerInner({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const projects = useProjects();
  const templates = useQuery({
    queryKey: queryKeys.taskTemplates(),
    queryFn: ({ signal }) => planningApi.templates({}, signal),
    enabled: open,
  });
  const [chosen, setChosen] = useState<TaskTemplate | null>(null);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState<string | undefined>();
  const use = useMutation({
    mutationFn: () => planningApi.useTemplate(chosen!.id, { title: title.trim() || chosen!.title, project_id: project }),
    onSuccess: (made) => {
      message.success(`${made.title} created from “${chosen?.name}”`);
      refreshRecordViews(queryClient);
      onClose();
      setChosen(null);
      onCreated(made.id);
    },
    onError: apiMessageToast(message, "The task could not be created."),
  });
  return (
    <Modal
      open={open}
      width={720}
      title="New task from a template"
      okText="Create task"
      okButtonProps={{ disabled: !chosen }}
      confirmLoading={use.isPending}
      onCancel={onClose}
      onOk={() => use.mutate()}
    >
      <div className="nx-pl-templates" role="list" data-testid="template-list">
        {(templates.data?.items ?? []).map((template) => (
          <button
            key={template.id}
            type="button"
            role="listitem"
            className="nx-pl-template"
            style={{ ["--nx-pl-tone" as string]: template.cover_color ?? "transparent" }}
            aria-pressed={chosen?.id === template.id}
            onClick={() => {
              setChosen(template);
              setTitle(template.title);
            }}
          >
            <strong>{template.name}</strong>
            <span>
              {template.kind.toLowerCase()} · {template.checklist.length} steps
              {template.story_points != null ? ` · ${template.story_points} pts` : ""}
              {template.due_in_days != null ? ` · due in ${template.due_in_days}d` : ""}
            </span>
            <span>Used {template.usage_count}×</span>
          </button>
        ))}
        {templates.data?.items.length === 0 && <Typography.Text type="secondary">No templates yet — save a task as one from its page.</Typography.Text>}
      </div>
      {chosen && (
        <Space direction="vertical" style={{ width: "100%", marginTop: 16 }}>
          <Input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            aria-label="Project"
            placeholder="No project"
            style={{ width: "100%" }}
            value={project}
            onChange={setProject}
            options={projectOptions(projects.data)}
          />
        </Space>
      )}
    </Modal>
  );
}

/** Rendered only while its feature flag is on (§27). */
export const TemplatePicker = withFeature(FEATURES.recurringTasks, TemplatePickerInner);
