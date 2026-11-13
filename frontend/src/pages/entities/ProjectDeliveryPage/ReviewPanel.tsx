import { Card, Descriptions, Space } from "antd";

import type { RecordPage } from "@/components/records/useRecordPage";
import { asText } from "@/lib/text";
import { ChoiceField, PersonField } from "@/entities/detail";
import { absoluteTime } from "@/lib/time";

/** The review panel: the fields a delivery review changes, and the dates and money it reads. */
export function ReviewPanel({ page, money }: { page: RecordPage; money: (value: unknown) => string }) {
  const project = page.record!;
  return (
    <Card size="small" title="Review" data-testid="project-review">
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <ChoiceField page={page} field="health" label="Health" loading={page.writing} />
        <ChoiceField page={page} field="phase" label="Phase" />
        <ChoiceField page={page} field="status" label="Status" value={project.status} />
        <PersonField page={page} field="owner_id" label="Owner" placeholder="Nobody yet" />
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
