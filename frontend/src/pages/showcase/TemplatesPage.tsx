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

import { Alert, Button, Card, Modal, Segmented, Space, Tag, Typography } from "antd";
import { AppstoreOutlined, ArrowRightOutlined, BuildOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePageCommands } from "@/commands/CommandContext";

import { PageHeader } from "@/components/PageHeader";

import { CodeBlock } from "./docs/CodeBlock";
import { Stage } from "./docs/DemoFrame";
import { TEMPLATES, TEMPLATE_SOURCE } from "./docs/sources";
import { STARTERS, type StarterTemplate } from "./docs/templateRegistry";
import { URL_OVERLAY } from "@/app/history";
import { useUrlOverlay } from "@/app/useUrlOverlay";
import { StatusTag } from "@/components/StatusTag";
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
/** Three rows, for the split-view miniature. A shape, not a dataset. */
const PREVIEW_ROWS = [
  {
    reference: "TIC-00041",
    title: "Printer on fire in the north wing",
    status: "OPEN",
    who: "Lakeside Group",
    body: "Reported this morning. The smoke has stopped, which the reporter considers progress.",
  },
  {
    reference: "TIC-00042",
    title: "Export finishes but the file is empty",
    status: "IN_PROGRESS",
    who: "Northwind Trading",
    body: "Reproduced on a filtered ledger of 40 000 rows. The queue accepted it and wrote nothing.",
  },
  {
    reference: "TIC-00043",
    title: "Login loops on Safari 17",
    status: "RESOLVED",
    who: "Harbour Logistics",
    body: "The redirect kept its own hash. Fixed by reading the token before the router boots.",
  },
];

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

/**
 * A layout's shape, drawn from its declaration.
 *
 * Twelve columns, because that is the grid the product is built on — so a
 * region reading "span 4" here is a region that would be `span={4}` there.
 * `role="img"` with one label rather than a dozen announced boxes: a screen
 * reader gets the sentence the picture is making, which is the shape, and not
 * a recitation of its parts.
 */
function Wireframe({ layout }: { layout: PageLayout }) {
  return (
    <div
      className="nu-wire"
      role="img"
      data-testid={`wireframe-${layout.key}`}
      aria-label={`${layout.name}: ${layout.wireframe
        .map((row) => row.map((region) => region.label).join(", then "))
        .join("; below that, ")}`}
    >
      {layout.wireframe.map((row, index) => (
        <div className="nu-wire-row" key={index}>
          {row.map((region) => (
            <span
              key={region.label + String(region.span)}
              className={`nu-wire-box${region.primary ? " is-primary" : ""}`}
              style={{
                gridColumn: `span ${region.span}`,
                ...(region.rows ? { gridRow: `span ${region.rows}` } : {}),
              }}
            >
              {region.label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The split view, in miniature (§62).
 *
 * A demonstration rather than a picture: the list on the left keeps its own
 * selection and scroll while the right pane changes, which is the whole claim
 * of the layout and the one thing a screenshot cannot show. Three rows is
 * enough — this is a shape, not a dataset.
 */
function SplitPreview() {
  const [chosen, setChosen] = useState(PREVIEW_ROWS[0]!.reference);
  const row = PREVIEW_ROWS.find((item) => item.reference === chosen) ?? PREVIEW_ROWS[0]!;

  return (
    <div className="nu-tmpl-preview" data-testid="split-preview">
      <ul className="nu-tmpl-preview-list">
        {PREVIEW_ROWS.map((item) => (
          <li key={item.reference}>
            <button
              type="button"
              className={`nu-tmpl-preview-row${
                item.reference === chosen ? " is-active" : ""
              }`}
              onClick={() => setChosen(item.reference)}
              aria-current={item.reference === chosen}
            >
              <span className="nu-tmpl-preview-ref">{item.reference}</span>
              <span className="nu-tmpl-preview-title">{item.title}</span>
              <StatusTag status={item.status} />
            </button>
          </li>
        ))}
      </ul>
      <div className="nu-tmpl-preview-detail" data-testid="split-preview-detail">
        <Text strong>{row.title}</Text>
        <Text type="secondary">
          {row.reference} · {row.who}
        </Text>
        <Paragraph type="secondary" className="nu-tmpl-preview-body">
          {row.body}
        </Paragraph>
        <Text type="secondary">
          The list keeps its place. On <Link to="/mail">/mail</Link> and{" "}
          <Link to="/tickets">/tickets</Link> the panes are addressable, so a
          selected item is a link somebody can send.
        </Text>
      </div>
    </div>
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

/** A starter template's live thumbnail: the real page, drawn small and inert. */
function Thumb({ id }: { id: string }) {
  const Page = TEMPLATES[id]?.default;
  return (
    // `inert` by attribute: React 18 has no prop for it, and a thumbnail must
    // not put a whole page of controls into the tab order.
    <div className="nx-tpl-thumb" aria-hidden="true" ref={(node) => node?.setAttribute("inert", "")}>
      <div className="nx-tpl-thumb-page">{Page ? <Page /> : null}</div>
    </div>
  );
}

/** One starter: thumbnail, when to use it, and its code a click away. */
function StarterCard({ starter, onOpen }: { starter: StarterTemplate; onOpen: () => void }) {
  return (
    <article className="nx-tpl-card" data-testid={`starter-${starter.id}`}>
      <button type="button" className="nx-tpl-preview" onClick={onOpen} aria-label={`Open the ${starter.name} template`}>
        <Thumb id={starter.id} />
      </button>
      <div className="nx-tpl-body">
        <b>{starter.name}</b>
        <span>{starter.when}</span>
        <span className="nx-tpl-pieces">
          {starter.pieces.map((piece) => (
            <Tag key={piece} bordered={false}>
              {piece}
            </Tag>
          ))}
        </span>
        <span className="nx-tpl-actions">
          <Button onClick={onOpen}>View code</Button>
          {starter.example && <Link to={starter.example}>See it live →</Link>}
        </span>
      </div>
    </article>
  );
}

/** The template, full size, with its source and a copy. */
function StarterModal({ starter, onClose }: { starter: StarterTemplate | null; onClose: () => void }) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const Page = starter ? TEMPLATES[starter.id]?.default : undefined;
  return (
    <Modal
      open={starter !== null}
      onCancel={() => {
        setView("preview");
        onClose();
      }}
      footer={null}
      width={1180}
      rootClassName={URL_OVERLAY}
      centered
      destroyOnClose
      className="nx-tpl-modal"
      title={
        starter ? (
          <span className="nx-ad-modal-title">
            <span>
              {starter.name} <em>template</em>
            </span>
            <small>{starter.when}</small>
          </span>
        ) : null
      }
    >
      {starter && (
        <div className="nx-doc-col" data-testid={`starter-detail-${starter.id}`}>
          <Segmented
            aria-label="Preview or code"
            value={view}
            onChange={(value) => setView(value as "preview" | "code")}
            options={[
              { value: "preview", label: "Preview" },
              { value: "code", label: "Code" },
            ]}
          />
          {view === "preview" ? (
            <Stage mode="app" className="nx-tpl-stage">
              {Page ? <Page /> : null}
            </Stage>
          ) : (
            <CodeBlock code={TEMPLATE_SOURCE[starter.id] ?? ""} file={`${starter.id}.tsx`} maxHeight={560} />
          )}
        </div>
      )}
    </Modal>
  );
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const shapes = useMemo(
    () => LAYOUTS.filter((layout) => layout.key !== "redirect"),
    [],
  );
  const rest = useMemo(
    () => LAYOUTS.filter((layout) => layout.key === "redirect"),
    [],
  );

  /**
   * What this page can do, for the palette (§31).
   *
   * A gallery is a page somebody arrives at from a question — "what does a
   * split view look like here" — so the commands are the shapes themselves,
   * each scrolling to its own section rather than leaving somebody to find it
   * in a page of eleven.
   */
  usePageCommands("showcase-templates", [
    ...shapes.map((layout) => ({
      id: `templates.${layout.key}`,
      label: `Show the ${layout.name.toLowerCase()} shape`,
      icon: <AppstoreOutlined />,
      keywords: `${layout.name} ${layout.shape} ${layout.when} layout template`,
      // Addressed by the same `data-testid` the tour and the tests use, rather
      // than by an `id` added for this: one anchor per card, three readers.
      run: () =>
        document
          .querySelector(`[data-testid="layout-${layout.key}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    })),
    {
      id: "templates.components",
      label: "See the components instead",
      icon: <BuildOutlined />,
      keywords: "components parts gallery showcase widgets",
      run: () => navigate("/showcase/components"),
    },
  ]);

  // In the address (`?template=wizard`), pushed: back closes it, a link opens it.
  const template = useUrlOverlay("template");
  const opened = STARTERS.find((starter) => starter.id === template.value) ?? null;

  return (
    <div className="nu-tmpl nx-ad nx-ad--templates">
      <PageHeader
        title={<>Page <em>templates</em></>}
        subtitle={summary()}
        tag={<Tag bordered={false}>{shapes.length} shapes</Tag>}
      />

      <section className="nx-tpl-section" aria-labelledby="starters-title" data-testid="starters">
        <h2 id="starters-title" className="nx-doc-grouptitle">Start a page from a template</h2>
        <p className="nx-doc-muted">
          {STARTERS.length} starter pages, each a real page built from the shared components. Open one to see it full
          size and copy its TSX.
        </p>
        <div className="nx-tpl-grid">
          {STARTERS.map((starter) => (
            <StarterCard key={starter.id} starter={starter} onOpen={() => template.open(starter.id)} />
          ))}
        </div>
        <StarterModal starter={opened} onClose={template.close} />
      </section>

      <h2 className="nx-doc-grouptitle">Every page shape in the product</h2>
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
