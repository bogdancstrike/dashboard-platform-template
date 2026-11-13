
import { Card, Space, Tag, Typography } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { type PageLayout } from "@/pages/showcase/templates";

import { SplitPreview } from "./SplitPreview";
import { Wireframe } from "./Wireframe";
import { routeLabel } from "./templateCopy";

const { Text, Paragraph } = Typography;

export function LayoutCard({ layout }: { layout: PageLayout }) {
  return (
    <Card
      size="small"
      className="nu-tmpl-card"
      data-testid={`layout-${layout.key}`}
      title={
        <Space size={8}>
          <Text strong>{layout.name}</Text>
          <Tag bordered={false}>{layout.routes.length}</Tag>
        </Space>
      }
    >
      <Paragraph className="nu-tmpl-shape">{layout.shape}</Paragraph>

      {/* The shape itself. A gallery of *names* asks a reader to imagine it;
          this does not. Structure rather than a picture, so it themes, scales
          and can be read aloud — and cannot drift from the page it describes
          the way a screenshot does. */}
      <Wireframe layout={layout} />

      <div className="nu-tmpl-rules">
        <div className="nu-tmpl-rule">
          <Text strong className="nu-tmpl-label">
            Use it when
          </Text>
          <Text type="secondary">{layout.when}</Text>
        </div>
        <div className="nu-tmpl-rule">
          {/* The half a gallery usually omits, and the half that stops
              somebody reaching for a split view over a table. */}
          <Text strong className="nu-tmpl-label nu-tmpl-unless">
            Not when
          </Text>
          <Text type="secondary">{layout.unless}</Text>
        </div>
      </div>

      {/* One layout gets a live miniature: the split view is the shape hardest
          to judge from a sentence, because what makes it work is that the
          list *stays put* while the detail changes (§62, §63). The rest are
          better judged by opening a real page, which is what the links are
          for. */}
      {layout.key === "split" && <SplitPreview />}

      {/* The question after "which shape" is always "what do I need", and a
          gallery that answers the first and not the second has stopped one
          step short of being useful. */}
      <div className="nu-tmpl-pieces">
        <Text strong className="nu-tmpl-label">
          Built from
        </Text>
        <Space size={4} wrap>
          {layout.pieces.map((piece) => (
            <Tag key={piece} bordered={false} className="nu-tmpl-piece">
              {piece}
            </Tag>
          ))}
        </Space>
      </div>

      <div className="nu-tmpl-rule">
        <Text strong className="nu-tmpl-label">
          In the address
        </Text>
        <Text type="secondary">{layout.url}</Text>
      </div>

      <div className="nu-tmpl-links" data-testid={`routes-${layout.key}`}>
        {layout.routes.map((route) => (
          // Real pages carrying real data: the fastest way to judge a layout
          // is to open one.
          <Link key={route} to={routeLabel(route)} className="nu-tmpl-link">
            {routeLabel(route)}
            <ArrowRightOutlined />
          </Link>
        ))}
      </div>
    </Card>
  );
}
