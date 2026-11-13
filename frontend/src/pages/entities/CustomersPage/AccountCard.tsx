import { Avatar, Card, Progress, Space, Tag, Tooltip, Typography } from "antd";
import { MailOutlined, ShopOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";

import type { HealthBand } from "@/api/recordsAnalytics";
import { BandPill } from "@/components/recordsAnalytics/parts";
import { humanStatus, StatusTag } from "@/components/StatusTag";
import { RecordActions, type RecordEditing } from "@/components/records/useRecordEditing";
import { absoluteTime, relativeTime } from "@/lib/time";
import { SEMANTIC } from "@/theme/tokens";

import type { CustomerRow } from "./types";

const { Text, Paragraph } = Typography;

/** Satisfaction is out of ten; the colour is the reading, not the number. */
function moodColour(score: number): string {
  if (score >= 7.5) return SEMANTIC.success;
  if (score >= 5) return SEMANTIC.warning;
  return SEMANTIC.danger;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** One account, read as a whole: who, what they are worth, how they feel, when anybody last spoke to them. */
export function AccountCard({ customer, records }: { customer: CustomerRow; records: RecordEditing }) {
  const navigate = useNavigate();
  const score = Number(customer.satisfaction ?? 0);
  return (
    <Card
      size="small"
      hoverable
      className="nu-account"
      onClick={() => navigate(`/customers/${customer.id}`)}
    >
      <div className="nu-account-head">
        <Avatar
          shape="square"
          size={40}
          // The accent *ink*, not the fill: on the accent-soft tint
          // the fill measures 4.2:1, which axe found here in the
          // dark appearance. Same rule as every tinted row (§55).
          style={{ background: "var(--nu-accent-soft)", color: "var(--nu-accent-ink)" }}
        >
          {initials(customer.name ?? "?")}
        </Avatar>
        <div className="nu-account-name">
          <Text strong ellipsis>
            {/* A real link, so the card is reachable by keyboard and opens in a
              new tab; it stops the click so the card's own handler
              does not push the same page a second time. */}
          <Link
            to={`/customers/${customer.id}`}
            className="nu-card-link"
            onClick={(event) => event.stopPropagation()}
          >
            {customer.name}
          </Link>
          </Text>
          <Text type="secondary">
            {customer.code} · {customer.city}, {customer.country}
          </Text>
        </div>
        <StatusTag status={customer.status} bordered={false} />
        <BandPill
          band={(customer as unknown as Record<string, unknown>).health_band as HealthBand | null}
          score={(customer as unknown as Record<string, unknown>).health_score as number | null}
        />
        <RecordActions
          records={records}
          id={customer.id}
          label={customer.code ?? customer.name ?? "this account"}
        />
      </div>

      <div className="nu-account-value">
        <span className="nu-account-amount">
          €{Math.round(Number(customer.lifetime_value ?? 0)).toLocaleString()}
        </span>
        <Text type="secondary">lifetime value</Text>
      </div>

      <span className="nx-rec-sat">
        <span>Satisfaction</span>
        <b style={{ color: moodColour(score) }}>{score.toFixed(1)}/10</b>
      </span>
      <Tooltip title={`Satisfaction ${score.toFixed(1)} out of 10`}>
        <Progress
          aria-label={`Satisfaction ${score.toFixed(1)} out of 10`}
          percent={score * 10}
          size="small"
          showInfo={false}
          strokeColor={moodColour(score)}
        />
      </Tooltip>

      <Space size={6} wrap className="nu-account-meta">
        <Tag bordered={false}>{humanStatus(customer.segment ?? "")}</Tag>
        <Text type="secondary">
          <ShopOutlined /> {customer.industry}
        </Text>
      </Space>

      <Paragraph className="nu-account-contact" ellipsis>
        <MailOutlined /> {customer.email}
      </Paragraph>

      <Tooltip title={absoluteTime(customer.last_contact_at)}>
        <Text type="secondary" className="nu-account-touch">
          Last contact {relativeTime(customer.last_contact_at)}
        </Text>
      </Tooltip>
    </Card>
  );
}
