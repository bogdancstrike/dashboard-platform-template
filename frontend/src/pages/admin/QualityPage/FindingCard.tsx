import { Card, Space, Tag, Typography } from "antd";
import { Link } from "react-router-dom";

import type { QualityFinding } from "@/api/quality";
import { withOrigin } from "@/entities/drilldown";
import { formatNumber } from "@/lib/formats";

import { SEVERITY_TONE } from "./qualityRank";

const { Text, Paragraph } = Typography;

/** One check with something in it: why it matters, what to do, and the rows. */
export function FindingCard({ finding }: { finding: QualityFinding }) {
  return (
    <Card
      size="small"
      className="nu-quality-card"
      data-testid={`quality-${finding.key}`}
      title={
        <Space size={8} wrap>
          <Tag color={SEVERITY_TONE[finding.severity]}>{finding.severity}</Tag>
          <Text strong>{finding.title}</Text>
          <Text type="secondary">{finding.resource_label}</Text>
        </Space>
      }
      extra={
        finding.link ? (
          // The count *is* the link: the check is declared as the list's own
          // filter, so this opens exactly the rows that were counted (§44).
          <Link
            to={withOrigin(finding.link, "/admin/quality")}
            data-testid={`quality-open-${finding.key}`}
          >
            Open {formatNumber(finding.count)}
          </Link>
        ) : (
          <Text strong>{formatNumber(finding.count)}</Text>
        )
      }
    >
      <Paragraph className="nu-quality-why">{finding.why}</Paragraph>
      <Paragraph type="secondary" className="nu-quality-fix">
        <Text strong>What to do: </Text>
        {finding.fix}
      </Paragraph>

      {!finding.link && (
        <>
          <Text type="secondary" className="nu-quality-nolink">
            {finding.why_no_link}
          </Text>
          <ul className="nu-quality-sample" data-testid={`quality-sample-${finding.key}`}>
            {finding.sample.map((entry) => (
              <li key={entry.id}>
                <Link to={entry.path}>{entry.label}</Link>
              </li>
            ))}
            {finding.count > finding.sample.length && (
              <li>
                <Text type="secondary">
                  and {formatNumber(finding.count - finding.sample.length)} more
                </Text>
              </li>
            )}
          </ul>
        </>
      )}
    </Card>
  );
}
