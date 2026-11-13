import { DatePicker, Segmented, Space } from "antd";

import { PERIOD_LABELS, type useSystemPage } from "./useSystemPage";

type Page = ReturnType<typeof useSystemPage>;

/** A named window, or a custom one — never both, or the page could not say which it drew. */
export function WindowPicker({ page }: { page: Page }) {
  const { range, setRange, period, setPeriod, history } = page;
  return (
    <Space size={8} wrap>
      <Segmented
        aria-label="Window"
        value={range ? "custom" : period}
        onChange={(next) => {
          // Choosing a named window clears the custom one, because two
          // windows in play is a page that cannot say which it drew.
          setRange(null);
          setPeriod(String(next));
        }}
        options={[
          ...(history.data?.periods ?? ["8h", "1d", "7d", "30d"]).map((key) => ({
            value: key,
            label: PERIOD_LABELS[key] ?? key,
          })),
          { value: "custom", label: "Custom", disabled: !range },
        ]}
      />
      <DatePicker.RangePicker
        showTime
        aria-label="Custom window"
        value={range}
        onChange={(value) =>
          setRange(value && value[0] && value[1] ? [value[0], value[1]] : null)
        }
        data-testid="health-range"
      />
    </Space>
  );
}
