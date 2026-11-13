import { Alert, Card, Space, Tag, Tooltip } from "antd";
import { CheckCircleOutlined } from "@ant-design/icons";

import type { QualityFinding, QualityOverview } from "@/api/quality";

import { FindingCard } from "./FindingCard";

/** The failing checks first, then the ones that came back empty — drawn, not omitted. */
export function QualityReport({ overview, findings }: { overview: QualityOverview; findings: QualityFinding[] }) {
  const failing = findings.filter((finding) => finding.count > 0);
  const passing = findings.filter((finding) => finding.count === 0);
  return (
    <>
      {failing.length === 0 ? (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          data-testid="quality-clean"
          message="Nothing to report"
          description={`All ${overview.totals.checks} checks came back empty. The checks themselves are listed below, so this is a clean bill rather than a page that failed to look.`}
        />
      ) : (
        <div className="nu-quality-list" data-testid="quality-findings">
          {failing.map((finding) => (
            <FindingCard key={finding.key} finding={finding} />
          ))}
        </div>
      )}

      {passing.length > 0 && (
        <Card
          size="small"
          className="nu-block"
          title={`${passing.length} checks with nothing in them`}
          data-testid="quality-passing"
        >
          {/* Drawn, because a page listing only problems cannot be told
              apart from a page whose checks are broken. */}
          <Space size={[6, 6]} wrap>
            {passing.map((finding) => (
              <Tooltip key={finding.key} title={finding.why}>
                <Tag icon={<CheckCircleOutlined />}>
                  {finding.resource_label}: {finding.title}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        </Card>
      )}
    </>
  );
}
