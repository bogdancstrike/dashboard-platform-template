import { Card, Col, Progress, Row, Typography } from "antd";

import type { projectStanding } from "@/entities/delivery";
import { SEMANTIC } from "@/theme/tokens";

const { Text } = Typography;

/**
 * The verdict's colour — the readable ink, not the fill.
 *
 * `SEMANTIC` is tuned for bars; this is a sentence, and green `#16a34a` on
 * white is 3.3:1, below the bar for text (§55). The ink ramp carries the same
 * four meanings at a lightness that can be read, in both themes.
 */
const STANDING_INK = {
  ahead: "var(--nu-success-ink)",
  even: "var(--nu-info-ink)",
  behind: "var(--nu-danger-ink)",
  done: "var(--nu-success-ink)",
} as const;


/**
 * The finding, above everything else: three measures of the same project that
 * are only interesting next to one another.
 */
export function StandingCard({
  standing,
  budgetCaption,
}: {
  standing: ReturnType<typeof projectStanding>;
  /** "12,000 EUR of 40,000 EUR". */
  budgetCaption: string;
}) {
  return (
    <Card size="small" data-testid="delivery-standing">
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          {/* Each bar is coloured by its *own* state rather than by the
              verdict, because a red bar over "85% delivered" reads as
              "delivering is going badly". What is going badly is the
              relationship between the three, and that is the sentence's
              job. */}
          <Gauge
            label="Delivered"
            percent={standing.progress}
            caption="what the team reports as done"
            colour="var(--nu-accent)"
          />
        </Col>
        <Col xs={24} md={8}>
          <Gauge
            label="Schedule"
            percent={standing.elapsed}
            caption={
              standing.daysLeft === null
                ? "no start and due date"
                : standing.daysLeft < 0
                  ? `${Math.abs(standing.daysLeft)} days past due`
                  : `${standing.daysLeft} days left`
            }
            colour={spentColour(standing.elapsed, standing.daysLeft !== null && standing.daysLeft < 0)}
          />
        </Col>
        <Col xs={24} md={8}>
          <Gauge
            label="Budget"
            percent={standing.burn}
            caption={budgetCaption}
            colour={spentColour(standing.burn, (standing.burn ?? 0) > 100)}
          />
        </Col>
      </Row>
      <Text
        strong
        data-testid="delivery-summary"
        className="nx-rec-verdict"
        style={{ color: STANDING_INK[standing.standing] }}
      >
        {standing.summary}
      </Text>
    </Card>
  );
}


/**
 * How a "how much is used up" bar is coloured.
 *
 * Neutral while there is room, amber in the last tenth and red once it is
 * gone — the two bars that can be *overspent* say so before they are, because
 * a budget noticed at 100% is a budget noticed too late. Deliberately not
 * AntD's default, which turns a bar green at 100%: a schedule that is fully
 * used is not a success.
 */
function spentColour(percent: number | null, over: boolean): string {
  if (over) return SEMANTIC.danger;
  if (percent !== null && percent >= 90) return SEMANTIC.warning;
  return "var(--nu-accent)";
}

/**
 * One measure of the project, as a bar with what it means underneath.
 *
 * A percentage with no caption is a number nobody can act on: "62%" of what,
 * against what. The caption is not decoration — it is the unit.
 */
function Gauge({
  label,
  percent,
  caption,
  colour,
}: {
  label: string;
  /** `null` when the record does not carry what it would take to compute it. */
  percent: number | null;
  caption: string;
  colour?: string;
}) {
  return (
    <div className="nx-rec-gauge">
      <div className="nx-rec-gauge-head">
        <Text strong className="nu-field-label">
          {label}
        </Text>
        {percent !== null && (
          <span className="nx-rec-gauge-n">
            {Math.round(percent)}
            <small>%</small>
          </span>
        )}
      </div>
      {percent === null ? (
        <Text type="secondary">Not enough information</Text>
      ) : (
        <Progress
          // Named, because a bar without one is announced as a number with no
          // subject — and this panel draws three of them side by side (§55).
          aria-label={`${label}: ${Math.round(percent)}% — ${caption}`}
          className="nu-gauge"
          percent={Math.min(Math.round(percent), 100)}
          strokeColor={colour}
          showInfo={false}
        />
      )}
      <Text type="secondary" className="nx-rec-gauge-cap">
        {caption}
      </Text>
    </div>
  );
}
