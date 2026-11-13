import { Button, Segmented, Select, Space, Typography } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";

import { type CalendarWindow } from "@/api/calendar";
import { isoDay, shift, titleFor, type CalendarView } from "@/lib/calendarGrid";

const { Title } = Typography;

/** Back, forward and today; the period's title; the kind filter and whose events. */
export function CalendarBar({
  view,
  anchor,
  category,
  onlyMine,
  data,
  set,
}: {
  view: CalendarView;
  anchor: Date;
  category: string;
  onlyMine: boolean;
  data: CalendarWindow | undefined;
  set: (changes: Record<string, string | null>) => void;
}) {
  const counts = data?.counts;
  const step = (direction: 1 | -1) => set({ on: isoDay(shift(view, anchor, direction)) });
  return (
    <div className="nu-cal-bar">
      <Space size={4}>
        <Button
          type="text"
          icon={<LeftOutlined />}
          onClick={() => step(-1)}
          aria-label="Previous"
          data-testid="cal-prev"
        />
        <Button
          type="text"
          icon={<RightOutlined />}
          onClick={() => step(1)}
          aria-label="Next"
          data-testid="cal-next"
        />
        <Button onClick={() => set({ on: null })} data-testid="cal-today">
          Today
        </Button>
      </Space>

      <Title level={5} className="nu-cal-title" data-testid="cal-title">
        {titleFor(view, anchor)}
      </Title>

      <Space size={8}>
        <Select
          aria-label="Kind"
          allowClear
          placeholder="Every kind"
          value={category || undefined}
          onChange={(next: string | undefined) => set({ category: next ?? null })}
          style={{ minWidth: 148 }}
          options={(data?.categories ?? []).map((item) => ({
            value: item,
            label: `${item.charAt(0)}${item.slice(1).toLowerCase()}${
              counts?.by_category[item] ? ` (${counts.by_category[item]})` : ""
            }`,
          }))}
        />
        <Segmented
          aria-label="Whose"
          value={onlyMine ? "mine" : "all"}
          onChange={(next) => set({ mine: next === "mine" ? "1" : null })}
          options={[
            { value: "all", label: `Everybody (${counts?.total ?? 0})` },
            { value: "mine", label: `Mine (${counts?.mine ?? 0})` },
          ]}
        />
      </Space>
    </div>
  );
}
