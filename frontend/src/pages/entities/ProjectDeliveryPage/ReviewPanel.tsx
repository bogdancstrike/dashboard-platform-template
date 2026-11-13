import { Card, Descriptions, Select, Space } from "antd";

import { PeoplePicker } from "@/components/PeoplePicker";
import type { RecordPage } from "@/components/records/useRecordPage";
import { humanStatus } from "@/components/StatusTag";
import { Field } from "@/entities/detail";
import { asText } from "@/lib/text";
import { absoluteTime } from "@/lib/time";

/** The review panel: the fields a delivery review changes, and the dates and money it reads. */
export function ReviewPanel({ page, money }: { page: RecordPage; money: (value: unknown) => string }) {
  const project = page.record!;
  return (
    <Card size="small" title="Review" data-testid="project-review">
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Field label="Health">
          <Select
            aria-label="Health"
            style={{ width: "100%" }}
            value={asText(page.value("health"))}
            disabled={!project.can_edit}
            loading={page.writing}
            onChange={(next) => page.write({ health: next })}
            options={page.choices("health").map((choice) => ({
              value: choice,
              label: humanStatus(choice),
            }))}
          />
        </Field>

        <Field label="Phase">
          <Select
            aria-label="Phase"
            style={{ width: "100%" }}
            value={asText(page.value("phase"))}
            disabled={!project.can_edit}
            onChange={(next) => page.write({ phase: next })}
            options={page.choices("phase").map((choice) => ({
              value: choice,
              label: humanStatus(choice),
            }))}
          />
        </Field>

        <Field label="Status">
          <Select
            aria-label="Status"
            style={{ width: "100%" }}
            value={project.status}
            disabled={!project.can_edit}
            onChange={(next) => page.write({ status: next })}
            options={page.choices("status").map((choice) => ({
              value: choice,
              label: humanStatus(choice),
            }))}
          />
        </Field>

        <Field label="Owner">
          <PeoplePicker
            multiple={false}
            aria-label="Owner"
            placeholder="Nobody yet"
            disabled={!project.can_edit}
            value={page.value("owner_id") ? [asText(page.value("owner_id"))] : []}
            onChange={(ids) => page.write({ owner_id: ids[0] ?? null })}
          />
        </Field>

        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="Priority">
            {asText(page.value("priority")) || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Started">
            {page.value("start_date")
              ? absoluteTime(asText(page.value("start_date")))
              : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Due">
            {page.value("due_date") ? absoluteTime(asText(page.value("due_date"))) : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Completed">
            {page.value("completed_at")
              ? absoluteTime(asText(page.value("completed_at")))
              : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Budget">{money(page.value("budget"))}</Descriptions.Item>
          <Descriptions.Item label="Spent">{money(page.value("spent"))}</Descriptions.Item>
          <Descriptions.Item label="Remaining">
            {money(Number(page.value("budget") ?? 0) - Number(page.value("spent") ?? 0))}
          </Descriptions.Item>
        </Descriptions>
      </Space>
    </Card>
  );
}
