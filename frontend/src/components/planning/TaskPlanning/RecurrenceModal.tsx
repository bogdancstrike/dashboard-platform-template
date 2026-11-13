import { useMutation } from "@tanstack/react-query";
import {
  App as AntApp,
  Button,
  Checkbox,
  DatePicker,
  Form,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Typography,
} from "antd";
import dayjs from "dayjs";

import { apiMessageToast } from "@/lib/errors";
import { planningApi, type Recurrence } from "@/api/planning";

import { FEATURES, withFeature } from "@/settings/features";

import { SAVE_FAILED, WEEKDAYS } from "./shared";

/** How a task repeats: daily, weekly on chosen days, monthly, or every N days/weeks. */
export function RecurrenceModalInner({
  open,
  id,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  id: string;
  current: Recurrence | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const frequency = Form.useWatch("frequency", form) as Recurrence["frequency"] | undefined;
  const save = useMutation({
    mutationFn: (values: Partial<Recurrence>) => planningApi.setRecurrence(id, values),
    onSuccess: (result) => {
      message.success(result.recurrence.summary);
      onSaved();
      onClose();
    },
    onError: apiMessageToast(message, SAVE_FAILED),
  });
  const clear = useMutation({
    mutationFn: () => planningApi.clearRecurrence(id),
    onSuccess: () => {
      message.success("This task no longer repeats");
      onSaved();
      onClose();
    },
    onError: apiMessageToast(message, SAVE_FAILED),
  });
  return (
    <Modal
      open={open}
      title="Repeat this task"
      okText="Save"
      confirmLoading={save.isPending}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnClose
      footer={(origin) => (
        <>
          {current && (
            <Button danger onClick={() => clear.mutate()} loading={clear.isPending} style={{ float: "left" }}>
              Stop repeating
            </Button>
          )}
          {origin}
        </>
      )}
    >
      <Typography.Paragraph type="secondary">
        When it comes due, the scheduler makes a fresh copy — same title, checklist unticked, the same length
        between start and due — and moves on to the next date.
      </Typography.Paragraph>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          frequency: current?.frequency ?? "WEEKLY",
          interval: current?.interval ?? 1,
          unit: current?.unit ?? "DAY",
          weekdays: current?.weekdays.length ? current.weekdays : [0],
          month_day: current?.month_day ?? 1,
          until: current?.until ? dayjs(current.until) : null,
        }}
        onFinish={(values: { frequency: Recurrence["frequency"]; interval: number; unit: "DAY" | "WEEK"; weekdays: number[]; month_day: number; until: dayjs.Dayjs | null }) =>
          save.mutate({
            frequency: values.frequency,
            interval: values.interval,
            unit: values.unit,
            weekdays: values.frequency === "WEEKLY" ? values.weekdays : [],
            month_day: values.frequency === "MONTHLY" ? values.month_day : null,
            until: values.until ? values.until.format("YYYY-MM-DD") : null,
          })
        }
      >
        <Form.Item name="frequency" label="Repeats">
          <Segmented
            options={[
              { value: "DAILY", label: "Daily" },
              { value: "WEEKLY", label: "Weekly" },
              { value: "MONTHLY", label: "Monthly" },
              { value: "CUSTOM", label: "Custom" },
            ]}
          />
        </Form.Item>
        <Space align="start" wrap>
          <Form.Item name="interval" label="Every">
            <InputNumber aria-label="Every" min={1} max={365} />
          </Form.Item>
          {frequency === "CUSTOM" && (
            <Form.Item name="unit" label="Unit">
              <Select aria-label="Unit" style={{ width: 110 }} options={[{ value: "DAY", label: "days" }, { value: "WEEK", label: "weeks" }]} />
            </Form.Item>
          )}
          {frequency === "MONTHLY" && (
            <Form.Item name="month_day" label="On day">
              <InputNumber aria-label="Day of the month" min={1} max={31} />
            </Form.Item>
          )}
        </Space>
        {frequency === "WEEKLY" && (
          <Form.Item name="weekdays" label="On">
            <Checkbox.Group options={WEEKDAYS.map((label, value) => ({ label, value }))} />
          </Form.Item>
        )}
        <Form.Item name="until" label="Until (optional)">
          <DatePicker aria-label="Until" style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Rendered only while its feature flag is on (§27). */
export const RecurrenceModal = withFeature(FEATURES.recurringTasks, RecurrenceModalInner);
