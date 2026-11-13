import { App, Input, Space, Typography } from "antd";

import { hours, type Week } from "@/api/time";

import { weekLabel } from "./timeCopy";

const { Text } = Typography;

/** Ask before a week is submitted, with an optional note for the approver. */
export function confirmSubmit(modal: ReturnType<typeof App.useApp>["modal"], data: Week, submit: (note: string) => Promise<unknown>) {
    let note = "";
    modal.confirm({
      title: `Submit ${weekLabel(data.week_start)}?`,
      icon: null,
      content: (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text>
            {hours(data.total_minutes)} in total, {hours(data.billable_minutes)} billable. The week locks until it is
            approved or sent back.
          </Text>
          <Input.TextArea rows={2} placeholder="A note for your approver (optional)" onChange={(e) => { note = e.target.value; }} />
        </Space>
      ),
      okText: "Submit week",
      onOk: () => submit(note),
    });
}
