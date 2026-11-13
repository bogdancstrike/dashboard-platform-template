
import { Card, Space, Tag, Typography } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { flowsOf, type CreateShapeSpec } from "@/pages/showcase/creates";

import { routeLabel } from "./templateCopy";

const { Text, Paragraph } = Typography;

/** One create shape, with the flows that use it. */
export function CreateCard({ shape }: { shape: CreateShapeSpec }) {
  const flows = flowsOf(shape.key);
  return (
    <Card
      size="small"
      className="nu-tmpl-card"
      data-testid={`create-${shape.key.replace(" ", "-")}`}
      title={
        <Space size={8}>
          <Text strong>{shape.name}</Text>
          <Tag bordered={false}>{flows.length}</Tag>
        </Space>
      }
    >
      <Paragraph className="nu-tmpl-shape">Built on: {shape.built}</Paragraph>

      <div className="nu-tmpl-rules">
        <div className="nu-tmpl-rule">
          <Text strong className="nu-tmpl-label">
            Use it when
          </Text>
          <Text type="secondary">{shape.when}</Text>
        </div>
        <div className="nu-tmpl-rule">
          <Text strong className="nu-tmpl-label nu-tmpl-unless">
            Not when
          </Text>
          <Text type="secondary">{shape.unless}</Text>
        </div>
      </div>

      {/* What actually opens this way, with the reason each one does — which
          is the part somebody choosing a shape for their own create reads. */}
      <ul className="nu-tmpl-flows">
        {flows.map((flow) => (
          <li key={flow.what}>
            <Link to={routeLabel(flow.where)} className="nu-tmpl-link">
              {flow.what}
              <ArrowRightOutlined />
            </Link>
            <Text type="secondary">{flow.because}</Text>
          </li>
        ))}
      </ul>
    </Card>
  );
}
