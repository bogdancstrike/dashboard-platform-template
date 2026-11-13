import { Alert, Card, Segmented, Space, Typography } from "antd";
import { FieldTimeOutlined } from "@ant-design/icons";

import type { UserPreferences } from "@/api/me";
import { formatSample } from "@/lib/formats";

import { Setting } from "./Setting";

const { Text } = Typography;

//: The choices, in the order the control offers them. The *labels* are
//: rendered from `formatSample`, so they are worked examples rather than a
//: fourth spelling of the pattern.
const DATE_PATTERNS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"] as const;
const NUMBER_PATTERNS = ["1,234.56", "1 234,56"] as const;
import type { SectionProps } from "./sectionProps";

export function FormatsSection({ preferences, save }: SectionProps) {
  const formats = preferences.formats;
  const sample = formatSample(formats);
  /** Send one field of one section, so the rest cannot be clobbered. */
  const setFormat = <K extends keyof UserPreferences["formats"]>(key: K, value: UserPreferences["formats"][K]) =>
    save({ formats: { [key]: value } });
  return (
    <Card
      size="small"
      title={
        <Space>
          <FieldTimeOutlined />
          <span>Dates, times and numbers</span>
        </Space>
      }
      data-testid="pref-formats"
      id="pref-formats"
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Setting label="Date" hint="Used by every timestamp in the platform.">
          <Segmented
            aria-label="Date format"
            value={formats.date}
            onChange={(next) => setFormat("date", next)}
            // Each label is the *same function* the rest of the app
            // renders with, so an option cannot promise a shape it does
            // not produce. The hardcoded labels did: `MM/DD/YYYY` said
            // "09/06/2026" and rendered an unpadded "9/6/2026"
            // everywhere else in the product.
            options={DATE_PATTERNS.map((pattern) => ({
              label: formatSample({ ...formats, date: pattern }).date,
              value: pattern,
            }))}
          />
        </Setting>

        <Setting label="Time">
          <Segmented
            aria-label="Time format"
            value={formats.time}
            onChange={(next) => setFormat("time", next as typeof formats.time)}
            options={[
              { label: "24-hour", value: "24h" },
              { label: "12-hour", value: "12h" },
            ]}
          />
        </Setting>

        <Setting label="Numbers">
          <Segmented
            aria-label="Number format"
            value={formats.number}
            // Typed by the options now, so the assertion the old
            // hardcoded list needed is gone.
            onChange={(next) => setFormat("number", next)}
            options={NUMBER_PATTERNS.map((pattern) => ({
              label: formatSample({ ...formats, number: pattern }).number,
              value: pattern,
            }))}
          />
        </Setting>

        {/* The effect, beside the control. A preference whose result you
            have to go and look for is one people set by trial. */}
        <Alert
          type="info"
          showIcon={false}
          data-testid="format-preview"
          message={
            <Space size={16} wrap>
              <span>
                <Text type="secondary">Date </Text>
                <Text strong>{sample.date}</Text>
              </span>
              <span>
                <Text type="secondary">Time </Text>
                <Text strong>{sample.time}</Text>
              </span>
              <span>
                <Text type="secondary">Number </Text>
                <Text strong>{sample.number}</Text>
              </span>
            </Space>
          }
        />
      </Space>
    </Card>
  );
}
