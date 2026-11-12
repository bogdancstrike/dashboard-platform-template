import { DatePicker, Form, Input, InputNumber, Modal, Radio, Space, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect } from "react";

import type { Sprint } from "@/api/planning";

export interface SprintValues {
  name: string;
  goal: string | null;
  start_date: string | null;
  end_date: string | null;
  capacity_points: number | null;
}

/** Plan a sprint, or change one: name, goal, dates and capacity. */
export function SprintFormModal({
  open,
  sprint,
  saving,
  onClose,
  onSubmit,
  mode = "edit",
}: {
  open: boolean;
  sprint?: Sprint | null;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (values: SprintValues) => void;
  /** `start` asks only for what starting needs to confirm. */
  mode?: "create" | "edit" | "start";
}) {
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    const start = sprint?.start_date ? dayjs(sprint.start_date) : mode === "start" || mode === "create" ? dayjs() : null;
    const end = sprint?.end_date ? dayjs(sprint.end_date) : start ? start.add(13, "day") : null;
    form.setFieldsValue({
      name: sprint?.name ?? "",
      goal: sprint?.goal ?? "",
      dates: start && end ? [start, end] : null,
      capacity_points: sprint?.capacity_points ?? null,
    });
  }, [open, sprint, form, mode]);

  const title = mode === "create" ? "Plan a sprint" : mode === "start" ? `Start ${sprint?.name ?? "the sprint"}` : `Edit ${sprint?.name ?? "sprint"}`;
  return (
    <Modal
      open={open}
      title={title}
      okText={mode === "create" ? "Create" : mode === "start" ? "Start sprint" : "Save"}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnClose
    >
      {mode === "start" && (
        <Typography.Paragraph type="secondary">
          Starting freezes the commitment: the points in the sprint now are what the velocity chart will compare
          the result against. Work added later is shown as added scope.
        </Typography.Paragraph>
      )}
      <Form
        form={form}
        layout="vertical"
        onFinish={(values: { name?: string; goal?: string; dates?: [Dayjs, Dayjs] | null; capacity_points?: number | null }) =>
          onSubmit({
            name: (values.name ?? "").trim(),
            goal: values.goal?.trim() || null,
            start_date: values.dates?.[0]?.format("YYYY-MM-DD") ?? null,
            end_date: values.dates?.[1]?.format("YYYY-MM-DD") ?? null,
            capacity_points: values.capacity_points ?? null,
          })
        }
      >
        {mode !== "start" && (
          <Form.Item name="name" label="Name" extra={mode === "create" ? "Leave empty for the next number." : undefined}>
            <Input aria-label="Sprint name" placeholder="Sprint 7" maxLength={120} />
          </Form.Item>
        )}
        <Form.Item name="goal" label="Goal">
          <Input.TextArea aria-label="Sprint goal" rows={2} placeholder="What this sprint is for, in one sentence" />
        </Form.Item>
        <Form.Item name="dates" label="Dates">
          <DatePicker.RangePicker aria-label="Sprint dates" style={{ width: "100%" }} />
        </Form.Item>
        {mode !== "start" && (
          <Form.Item name="capacity_points" label="Capacity (points)" extra="What the team expects to finish — a guide, never a limit.">
            <InputNumber aria-label="Capacity" min={0} max={9999} style={{ width: "100%" }} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

/** Complete a sprint: where does the unfinished work go? */
export function CompleteSprintModal({
  open,
  sprint,
  unfinished,
  hasNext,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  sprint: Sprint | null;
  unfinished: number;
  hasNext: boolean;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (carry: "backlog" | "next" | "new") => void;
}) {
  const [form] = Form.useForm<{ carry: "backlog" | "next" | "new" }>();
  return (
    <Modal
      open={open}
      title={`Complete ${sprint?.name ?? "the sprint"}`}
      okText="Complete sprint"
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnClose
    >
      <Typography.Paragraph>
        {sprint ? `${sprint.done_tasks} of ${sprint.total_tasks} tasks done — ${sprint.done_points} of ${sprint.total_points} points.` : null}
      </Typography.Paragraph>
      {unfinished > 0 ? (
        <Form form={form} layout="vertical" initialValues={{ carry: hasNext ? "next" : "backlog" }} onFinish={(values) => onSubmit(values.carry)}>
          <Form.Item name="carry" label={`Move the ${unfinished} unfinished task${unfinished === 1 ? "" : "s"} to`}>
            <Radio.Group>
              <Space direction="vertical">
                <Radio value="next" disabled={!hasNext}>
                  The next planned sprint
                </Radio>
                <Radio value="new">A new sprint</Radio>
                <Radio value="backlog">The backlog</Radio>
              </Space>
            </Radio.Group>
          </Form.Item>
        </Form>
      ) : (
        <Form form={form} initialValues={{ carry: "backlog" }} onFinish={(values) => onSubmit(values.carry)}>
          <Typography.Paragraph type="secondary">Everything is done. Nothing to carry over.</Typography.Paragraph>
        </Form>
      )}
    </Modal>
  );
}
