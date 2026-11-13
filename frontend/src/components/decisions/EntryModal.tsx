import { App, DatePicker, Form, Input, Modal, Segmented, Switch, TimePicker } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useState } from "react";

import { decimalHours, parseDuration, timeApi, type Subject, type TimeEntry } from "@/api/time";
import { errorText } from "@/lib/errors";

import { SubjectPicker, parseSubjectKey, subjectKey } from "./SubjectPicker";

interface Values {
  subject?: string;
  work_date: Dayjs;
  duration?: string;
  span?: [Dayjs, Dayjs];
  note?: string;
  billable: boolean;
}

/**
 * A manual time entry: a duration, or a start and an end, on a day.
 *
 * Opened from the week page, a task or a ticket. When the work item is
 * already known (`subject`) the picker shows it and can still be changed — a
 * person logging time from a ticket sometimes means the task beside it.
 */
export function EntryModal({
  open,
  onClose,
  entry,
  subject,
  day,
}: {
  open: boolean;
  onClose: () => void;
  /** Editing an existing entry rather than adding one. */
  entry?: TimeEntry | null;
  subject?: Subject;
  day?: string;
}) {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [form] = Form.useForm<Values>();
  const [mode, setMode] = useState<"duration" | "span">("duration");

  useEffect(() => {
    if (!open) return;
    const timed = Boolean(entry?.started_at && entry?.ended_at && entry.source !== "GRID");
    setMode(timed ? "span" : "duration");
    form.setFieldsValue({
      subject: entry?.subject_id
        ? subjectKey(entry.subject_type, entry.subject_id)
        : subject
          ? subjectKey(subject.subject_type, subject.subject_id)
          : undefined,
      work_date: dayjs(entry?.work_date ?? day ?? undefined),
      duration: entry ? decimalHours(entry.minutes) : "",
      span: timed ? [dayjs(entry!.started_at), dayjs(entry!.ended_at)] : undefined,
      note: entry?.note ?? "",
      billable: entry?.billable ?? true,
    });
  }, [open, entry, subject, day, form]);

  const save = useMutation({
    mutationFn: async (values: Values) => {
      const chosen = parseSubjectKey(values.subject);
      if (!chosen) throw new Error("Choose what the time was spent on.");
      const date = values.work_date.format("YYYY-MM-DD");
      const body: Parameters<typeof timeApi.create>[0] = {
        ...chosen,
        work_date: date,
        note: values.note ?? "",
        billable: values.billable,
      };
      if (mode === "span") {
        const [start, end] = values.span ?? [];
        if (!start || !end) throw new Error("Give a start and an end.");
        const on = (time: Dayjs) => values.work_date.hour(time.hour()).minute(time.minute()).second(0);
        body.started_at = on(start).toISOString();
        body.ended_at = on(end).toISOString();
      } else {
        const minutes = parseDuration(values.duration ?? "");
        if (!minutes) throw new Error("Type a duration like 1.5, 1:30 or 90m.");
        body.minutes = minutes;
      }
      return entry ? timeApi.update(entry.id, body) : timeApi.create(body);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["time"] });
      message.success(entry ? "Entry updated" : "Time logged");
      onClose();
    },
    onError: (error) => message.error(errorText(error, { action: "log time" })),
  });

  return (
    <Modal
      open={open}
      title={entry ? "Edit time entry" : "Log time"}
      okText={entry ? "Save" : "Log time"}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      forceRender
      data-testid="time-entry-modal"
    >
      <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)} requiredMark="optional">
        <Form.Item name="subject" label="Work item" rules={[{ required: true, message: "Choose a work item" }]}>
          <SubjectPicker initial={subject} />
        </Form.Item>
        <Form.Item name="work_date" label="Day" rules={[{ required: true }]}>
          <DatePicker style={{ width: "100%" }} allowClear={false} />
        </Form.Item>
        <Segmented
          block
          value={mode}
          onChange={(next) => setMode(next as "duration" | "span")}
          options={[
            { value: "duration", label: "Duration" },
            { value: "span", label: "Start and end" },
          ]}
          style={{ marginBottom: 16 }}
        />
        {mode === "duration" ? (
          <Form.Item
            name="duration"
            label="How long"
            extra="1.5, 1:30, 90m or 1h 30m"
            rules={[{ required: true, message: "Type a duration" }]}
          >
            <Input placeholder="1:30" inputMode="decimal" aria-label="Duration" />
          </Form.Item>
        ) : (
          <Form.Item name="span" label="From – to" rules={[{ required: true, message: "Give a start and an end" }]}>
            <TimePicker.RangePicker format="HH:mm" minuteStep={5} style={{ width: "100%" }} />
          </Form.Item>
        )}
        <Form.Item name="note" label="Note">
          <Input.TextArea rows={2} maxLength={500} placeholder="What you did" />
        </Form.Item>
        <Form.Item name="billable" label="Billable" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
