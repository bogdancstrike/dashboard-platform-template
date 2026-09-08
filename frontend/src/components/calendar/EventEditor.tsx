/**
 * Writing an event (§9, §19).
 *
 * A modal, and deliberately not the wizard the dashboard and the automation
 * get: an event is *one question with a shape* — when, what, who — asked at
 * once because the parts inform each other. Somebody moving a meeting an hour
 * later wants to see the attendees while they do it, and a three-step flow
 * that hides them is a flow they cancel out of.
 *
 * Two decisions worth stating.
 *
 * **The repeat is offered in words and stored as a rule.** "Every week on
 * Tuesday" is the question; `{freq, interval, byday}` is the answer the server
 * expands. The sentence under the control is the *server's* rendering after a
 * save, so what a reader was promised is what the expander will do (§51).
 *
 * **Editing a series says so, at the top, before anything is touched.** The
 * platform has no per-occurrence exception and pretending otherwise here would
 * be the most expensive kind of surprise.
 */

import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Switch,
  Typography,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect } from "react";

import {
  calendarApi,
  type CalendarEvent,
  type CalendarEventInput,
  type EventRecurrence,
} from "@/api/calendar";
import { ApiError } from "@/api/client";
import { MemberPicker } from "@/components/PeoplePicker";
import { WEEKDAY_CODES } from "@/components/calendar/weekdays";

const { Text } = Typography;

/** The unit an interval counts, per repeat. */
const INTERVAL_UNIT: Record<string, string> = {
  DAILY: "days",
  WEEKLY: "weeks",
  MONTHLY: "months",
};

interface FormValues {
  title: string;
  category: string;
  location?: string;
  description?: string;
  when: [Dayjs, Dayjs];
  all_day: boolean;
  participants?: string[];
  repeat: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  interval?: number;
  byday?: string[];
  until?: Dayjs | null;
  reminder_minutes?: number | null;
}

/**
 * The form's repeat answers, as the server's rule document.
 *
 * Pure and exported: "every second week on Tuesday and Thursday" is a claim
 * worth asserting directly, and a wrong rule here produces a series nobody
 * ever sees — the quietest failure a calendar has.
 */
export function recurrenceOf(values: {
  repeat: string;
  interval?: number;
  byday?: string[];
}): EventRecurrence | null {
  if (values.repeat === "NONE") return null;
  const rule: EventRecurrence = {
    freq: values.repeat as EventRecurrence["freq"],
    interval: Math.max(Number(values.interval ?? 1) || 1, 1),
  };
  // `byday` is only meaningful weekly. Sending it with a monthly rule would
  // be a document the server accepts and the expander ignores, which reads as
  // the form having been ignored.
  if (values.repeat === "WEEKLY" && values.byday?.length) rule.byday = values.byday;
  return rule;
}

/** An existing event, as the form's values. */
function valuesOf(event: CalendarEvent | null): Partial<FormValues> {
  if (!event) {
    const start = dayjs().add(1, "hour").startOf("hour");
    return {
      category: "MEETING",
      all_day: false,
      repeat: "NONE",
      interval: 1,
      when: [start, start.add(1, "hour")],
    };
  }
  return {
    title: event.title,
    category: event.category,
    location: event.location ?? undefined,
    description: event.description ?? undefined,
    all_day: event.all_day,
    when: [dayjs(event.starts_at), dayjs(event.ends_at)],
    participants: event.participants.map((person) => person.user_id),
    repeat: event.recurrence?.freq ?? "NONE",
    interval: event.recurrence?.interval ?? 1,
    byday: event.recurrence?.byday ?? [],
    until: event.recurrence_until ? dayjs(event.recurrence_until) : null,
    reminder_minutes: event.reminder_minutes,
  };
}

export function EventEditor({
  open,
  event,
  /** The day the reader clicked, when creating from the grid. */
  day,
  /**
   * The kinds the server declares, published with every window. Passed in
   * rather than listed here: `core/vocabulary.EVENT_CATEGORY` is the one
   * place, and a form offering a seventh kind the server refuses is a form
   * that fails on save.
   */
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  event: CalendarEvent | null;
  day?: Date | null;
  categories: string[];
  onClose: () => void;
  onSaved: (event: CalendarEvent) => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const { message } = AntApp.useApp();
  const repeat = Form.useWatch("repeat", form) as FormValues["repeat"] | undefined;
  const allDay = Form.useWatch("all_day", form) as boolean | undefined;

  // Reset on every open, not once: the same component serves "new event on
  // Tuesday" and "edit the standup", and a form that kept the previous
  // subject is a form that saves the wrong thing.
  useEffect(() => {
    if (!open) return;
    const values = valuesOf(event);
    if (!event && day) {
      const start = dayjs(day).hour(9).minute(0).second(0);
      values.when = [start, start.add(1, "hour")];
    }
    form.setFieldsValue(values);
  }, [open, event, day, form]);

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const [start, end] = values.when;
      const body: CalendarEventInput = {
        title: values.title,
        category: values.category,
        location: values.location ?? null,
        description: values.description ?? null,
        all_day: values.all_day,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        participants: (values.participants ?? []).map((id) => ({ user_id: id })),
        recurrence: recurrenceOf(values),
        recurrence_until:
          values.repeat === "NONE" ? null : (values.until?.toISOString() ?? null),
        reminder_minutes: values.reminder_minutes ?? null,
      };
      return event ? calendarApi.update(event.event_id, body) : calendarApi.create(body);
    },
    onSuccess: (saved) => {
      message.success(event ? `${saved.title} updated` : `${saved.title} is in the calendar`);
      onSaved(saved);
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "That event could not be saved.",
      ),
  });

  return (
    <Modal
      open={open}
      width={640}
      title={event ? "Edit event" : "New event"}
      okText={event ? "Save" : "Add it"}
      confirmLoading={save.isPending}
      onCancel={onClose}
      onOk={() => void form.submit()}
      okButtonProps={{ "data-testid": "save-event" }}
    >
      {/* Before anything is touched, not after it lands. */}
      {event?.recurrence && (
        <Alert
          className="nu-block"
          type="warning"
          showIcon
          message={`This repeats ${event.recurrence_text}`}
          description="Saving changes every occurrence. The platform has no exception for a single one."
        />
      )}

      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(values) => save.mutate(values)}
        data-testid="event-form"
      >
        <Form.Item
          name="title"
          label="What is it"
          rules={[{ required: true, message: "An event needs a title" }]}
        >
          <Input autoFocus maxLength={240} placeholder="Delivery review" />
        </Form.Item>

        <div className="nu-event-form-grid">
          <Form.Item name="category" label="Kind">
            <Select
              aria-label="Kind"
              options={categories.map((item) => ({
                value: item,
                label: item.charAt(0) + item.slice(1).toLowerCase(),
              }))}
            />
          </Form.Item>

          <Form.Item name="location" label="Where">
            <Input maxLength={200} placeholder="Room Aurora (4), or a link" />
          </Form.Item>

          <Form.Item name="all_day" label="All day" valuePropName="checked">
            <Switch aria-label="All day" />
          </Form.Item>

          <Form.Item
            name="reminder_minutes"
            label="Remind everybody"
            tooltip="Minutes before it starts. Nothing sends reminders yet — the value is stored for when scheduled jobs exist."
          >
            <InputNumber min={0} max={20160} addonAfter="min" style={{ width: "100%" }} />
          </Form.Item>
        </div>

        <Form.Item
          name="when"
          label="When"
          rules={[{ required: true, message: "An event needs a start and an end" }]}
        >
          <DatePicker.RangePicker
            showTime={!allDay}
            format={allDay ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm"}
            style={{ width: "100%" }}
            aria-label="When"
          />
        </Form.Item>

        <Form.Item name="description" label="What it is about">
          <Input.TextArea
            rows={2}
            maxLength={4000}
            placeholder="An agenda, or what people should bring."
          />
        </Form.Item>

        <Form.Item name="participants" label="Who is invited">
          <MemberPicker aria-label="Who is invited" placeholder="Search people by name" />
        </Form.Item>

        <Form.Item name="repeat" label="Repeats">
          <Segmented
            data-testid="repeat"
            options={[
              { value: "NONE", label: "Once" },
              { value: "DAILY", label: "Daily" },
              { value: "WEEKLY", label: "Weekly" },
              { value: "MONTHLY", label: "Monthly" },
            ]}
            block
          />
        </Form.Item>

        {repeat && repeat !== "NONE" && (
          <div className="nu-event-form-grid" data-testid="repeat-detail">
            <Form.Item name="interval" label="Every">
              <InputNumber
                min={1}
                max={52}
                style={{ width: "100%" }}
                addonAfter={INTERVAL_UNIT[repeat] ?? ""}
                aria-label="Interval"
              />
            </Form.Item>

            {repeat === "WEEKLY" && (
              <Form.Item name="byday" label="On">
                <Select
                  mode="multiple"
                  aria-label="Days"
                  placeholder="The day it starts on"
                  options={WEEKDAY_CODES.map(({ code, label }) => ({
                    value: code,
                    label,
                  }))}
                />
              </Form.Item>
            )}

            <Form.Item
              name="until"
              label="Until"
              tooltip="A repeat needs a horizon: a series with no end is one the calendar has to expand forever."
            >
              <DatePicker style={{ width: "100%" }} aria-label="Until" />
            </Form.Item>
          </div>
        )}

        <Text type="secondary">
          You are added as the organiser, and marked as going.
        </Text>
      </Form>
    </Modal>
  );
}
