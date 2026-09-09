/**
 * `/showcase/templates` — the page shapes this template offers (§61).
 *
 * Four decisions worth the reader's attention.
 *
 * **Every layout says when it is the *wrong* answer.** A gallery that only
 * lists what each shape is for invites somebody to reach for the most
 * impressive one — a split view over a table, a wizard around three fields.
 * The useful half is `unless`, so it is on every card and given the same
 * weight as `when`.
 *
 * **Each layout links to real pages built that way.** Not mockups: the fastest
 * way to judge a layout is to open one that is already carrying data, and a
 * gallery of pictures would be a second copy of the pages that drifts from
 * them.
 *
 * **The classification is complete, and a test enforces it.** Every route in
 * `App.tsx` belongs to exactly one layout, checked by `templates.test.ts`
 * against the router itself — because a hand-kept gallery is wrong by the
 * third new page and then quietly misleads everybody who reads it. The count
 * at the top is that completeness, published rather than assumed.
 *
 * **"Not a layout" is a category.** Redirects exist so links do not rot, and
 * pretending they are a page shape would be padding the gallery with
 * something nobody can look at.
 *
 * **How a create opens is the same kind of question**, one size down, so it is
 * answered on the same page: five shapes, when each fits, and every create in
 * the platform classified under one of them (`creates.ts`). A reader adding a
 * page needs both answers, and a platform where every create is a drawer is
 * telling them every decision is the same size.
 */

import { Alert, Card, Space, Tag, Typography } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/PageHeader";
import {
  CREATE_FLOWS,
  CREATE_SHAPES,
  flowsOf,
  type CreateShapeSpec,
} from "@/pages/showcase/creates";
import { LAYOUTS, classified, type PageLayout } from "@/pages/showcase/templates";
import { formatNumber } from "@/lib/formats";

const { Text, Paragraph } = Typography;

/** How a route reads as a link label — the address, which is what somebody types. */
export function routeLabel(route: string): string {
  return `/${route}`;
}

/**
 * The gallery's own summary: how many shapes, over how many pages.
 *
 * One sentence rather than two counters, and it names the *completeness*
 * because that is the property this page lives or dies on.
 */
export function summary(layouts: PageLayout[] = LAYOUTS): string {
  const shapes = layouts.filter((layout) => layout.key !== "redirect").length;
  const pages = classified().length;
  return `${shapes} page shapes across ${formatNumber(pages)} routes. Every route in the router is classified as exactly one of them, which a test enforces.`;
}

function LayoutCard({ layout }: { layout: PageLayout }) {
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

/** One create shape, with the flows that use it. */
function CreateCard({ shape }: { shape: CreateShapeSpec }) {
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

export default function TemplatesPage() {
  const shapes = useMemo(
    () => LAYOUTS.filter((layout) => layout.key !== "redirect"),
    [],
  );
  const rest = useMemo(
    () => LAYOUTS.filter((layout) => layout.key === "redirect"),
    [],
  );

  return (
    <div className="nu-tmpl">
      <PageHeader
        title="Page gallery"
        subtitle={summary()}
        tag={<Tag bordered={false}>{shapes.length} shapes</Tag>}
      />

      <Alert
        type="info"
        showIcon
        className="nu-tmpl-note"
        data-testid="completeness"
        message="Every route is classified, and a test keeps it that way"
        description="A page added to the router and not classified here fails `templates.test.ts`. That is the only way a gallery like this stays true — a hand-kept list is wrong by the third new page, and then it misleads everybody who reads it."
      />

      <div className="nu-tmpl-grid" data-testid="layouts">
        {shapes.map((layout) => (
          <LayoutCard key={layout.key} layout={layout} />
        ))}
      </div>

      <Text strong className="nu-tmpl-section">
        And how a create opens
      </Text>
      <Alert
        type="info"
        showIcon
        className="nu-tmpl-note"
        data-testid="creates-completeness"
        message="Five shapes, smallest decision first"
        description={`${CREATE_FLOWS.length} creates in the platform, each classified as exactly one of them, with the reason. A "new something" control added without that decision fails \`creates.test.ts\`.`}
      />
      <div className="nu-tmpl-grid" data-testid="creates">
        {CREATE_SHAPES.map((shape) => (
          <CreateCard key={shape.key} shape={shape} />
        ))}
      </div>

      {rest.length ? (
        <>
          <Text strong className="nu-tmpl-section">
            And what is not a layout
          </Text>
          <div className="nu-tmpl-grid" data-testid="non-layouts">
            {rest.map((layout) => (
              <LayoutCard key={layout.key} layout={layout} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
