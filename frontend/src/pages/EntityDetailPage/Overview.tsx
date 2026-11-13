import { Card, Col, Descriptions, Row, Tag, Tooltip, Typography } from "antd";

import type { RecordField } from "@/api/records";
import { StatusTag } from "@/components/StatusTag";
import { asText } from "@/lib/text";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;

/**
 * Every declared field, in two columns, with the identifiers last.
 *
 * Ordered by what a reader looks for rather than by the order the declaration
 * happens to be written in: the record's own attributes first, then the ids
 * that connect it to other records, then the timestamps. A detail page that
 * opens with a UUID is a detail page whose first line nobody reads.
 */
export function Overview({ fields, titleField }: { fields: RecordField[]; titleField: string }) {
  const isIdentifier = (field: RecordField) =>
    field.kind === "uuid" || field.name.endsWith("_id");
  const isStamp = (field: RecordField) =>
    field.name === "created_at" || field.name === "updated_at";

  const primary = fields.filter(
    (field) => !isIdentifier(field) && !isStamp(field) && field.name !== titleField,
  );
  const identifiers = fields.filter(isIdentifier);
  const stamps = fields.filter(isStamp);

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={16}>
        <Card size="small" title="Details">
          <Descriptions size="small" column={{ xs: 1, sm: 1, md: 2, lg: 2, xl: 2, xxl: 2 }} className="nx-rec-facts nx-rec-facts--grid">
            {primary.map((field) => (
              <Descriptions.Item key={field.name} label={field.label}>
                <FieldValue field={field} />
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      </Col>
      <Col xs={24} xl={8}>
        <Card size="small" title="References">
          <Descriptions size="small" column={1} className="nx-rec-facts">
            {[...identifiers, ...stamps].map((field) => (
              <Descriptions.Item key={field.name} label={field.label}>
                <FieldValue field={field} />
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      </Col>
    </Row>
  );
}

/** How one value is drawn, decided by the kind the server declared. */
function FieldValue({ field }: { field: RecordField }) {
  const { kind, value } = field;

  if (value === null || value === undefined || value === "") {
    // An explicit em dash, so an empty field is visibly empty rather than
    // looking like a rendering failure.
    return <Text type="secondary">—</Text>;
  }

  if (kind === "bool") {
    return <Tag color={value ? "green" : undefined}>{value ? "Yes" : "No"}</Tag>;
  }

  // `asText` rather than `String` throughout: a `json` or `array` field is an
  // object, and `String({})` is `[object Object]` — which reads as a bug in
  // the field rather than in the rendering of it.
  const text = asText(value);

  if (kind === "datetime") {
    return (
      <Tooltip title={absoluteTime(text)}>
        <Text>{relativeTime(text)}</Text>
      </Tooltip>
    );
  }

  if (kind === "enum") {
    return <StatusTag status={text} />;
  }

  if (kind === "number") {
    return <Text>{Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>;
  }

  if (kind === "uuid") {
    return (
      <Text type="secondary" copyable={{ text }} className="nu-record-id">
        {text}
      </Text>
    );
  }

  return <Text>{text}</Text>;
}
