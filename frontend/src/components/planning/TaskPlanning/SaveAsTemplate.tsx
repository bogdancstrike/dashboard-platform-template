import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Input, Modal, Tooltip, Typography } from "antd";
import { useState } from "react";

import { apiMessageToast } from "@/lib/errors";
import { planningApi } from "@/api/planning";

import { PlanIcon } from "@/components/icons/PlanIcon";
import { FEATURES, withFeature } from "@/settings/features";
import { queryKeys } from "@/lib/queryKeys";

import { SAVE_FAILED } from "./shared";

/** "Save as template" — the task's title, checklist, estimate and labels, for next time. */
export function SaveAsTemplateButtonInner({ id, title, disabled }: { id: string; title: string; disabled?: boolean }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(title);
  const save = useMutation({
    mutationFn: () => planningApi.saveAsTemplate(id, name.trim() || title),
    onSuccess: (template) => {
      message.success(`Saved as the template “${template.name}”`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates() });
      setOpen(false);
    },
    onError: apiMessageToast(message, SAVE_FAILED),
  });
  return (
    <>
      <Tooltip title={disabled ? "Your role does not include tasks.manage" : ""}>
        <Button icon={<PlanIcon name="template" />} disabled={disabled} onClick={() => setOpen(true)} data-testid="task-save-template">
          Save as template
        </Button>
      </Tooltip>
      <Modal open={open} title="Save as a template" okText="Save" confirmLoading={save.isPending} onCancel={() => setOpen(false)} onOk={() => save.mutate()}>
        <Typography.Paragraph type="secondary">
          The title, description, checklist (unticked), estimate, points, labels and cover are kept, and the length from
          start to due becomes “due in”.
        </Typography.Paragraph>
        <Input aria-label="Template name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
      </Modal>
    </>
  );
}

/** Rendered only while its feature flag is on (§27). */
export const SaveAsTemplateButton = withFeature(FEATURES.recurringTasks, SaveAsTemplateButtonInner);
