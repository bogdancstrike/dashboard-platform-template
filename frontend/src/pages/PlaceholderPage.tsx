import { Alert, Card, Space, Tag, Typography } from "antd";
import { ToolOutlined } from "@ant-design/icons";
import { useLocation } from "react-router-dom";

import { PageHeader } from "@/components/PageHeader";
import { NAV_ITEMS, selectedKeyFor } from "@/app/navigation";

const { Paragraph, Text } = Typography;

/**
 * A route that is navigable but not built yet.
 *
 * Deliberately honest rather than a blank page or a fake screen. It says which
 * spec section it will implement and what will be here, so somebody exploring
 * the template can tell "not written yet" apart from "broken" — and so the
 * navigation can be complete from the start, which is what makes the shell
 * worth reviewing before the pages exist.
 */
export function PlaceholderPage({
  section,
  summary,
  bullets = [],
}: {
  /** The requirement section this page will satisfy, e.g. "§21". */
  section: string;
  summary: string;
  bullets?: string[];
}) {
  const location = useLocation();
  const item = NAV_ITEMS.find((candidate) => candidate.key === selectedKeyFor(location.pathname));

  return (
    <>
      <PageHeader
        title={item?.label ?? "Page"}
        subtitle={summary}
        tag={<Tag color="default">{section}</Tag>}
      />
      <Card>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            icon={<ToolOutlined />}
            message="Not built yet"
            description={
              <Paragraph style={{ marginBottom: 0 }}>
                This route is wired into the shell so the navigation is complete and
                deep links resolve, but the screen itself is still to come. The tracker
                in <Text code>docs/TODO.md</Text> carries its acceptance criteria.
              </Paragraph>
            }
          />
          {bullets.length > 0 && (
            <div>
              <Text strong>What will be here</Text>
              <ul style={{ marginTop: 8, marginBottom: 0, paddingInlineStart: 20 }}>
                {bullets.map((bullet) => (
                  <li key={bullet} style={{ marginBottom: 4 }}>
                    <Text type="secondary">{bullet}</Text>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Space>
      </Card>
    </>
  );
}
