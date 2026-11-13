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

import { Alert, Tag, Typography } from "antd";
import { AppstoreOutlined, BuildOutlined } from "@ant-design/icons";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { usePageCommands } from "@/commands/CommandContext";

import { PageHeader } from "@/components/PageHeader";

import { STARTERS } from "../docs/templateRegistry";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { CREATE_FLOWS, CREATE_SHAPES } from "@/pages/showcase/creates";
import { LAYOUTS } from "@/pages/showcase/templates";

import { CreateCard } from "./CreateCard";
import { LayoutCard } from "./LayoutCard";
import { StarterCard } from "./StarterCard";
import { StarterModal } from "./StarterModal";
import { summary } from "./templateCopy";

export { routeLabel, summary } from "./templateCopy";

const { Text } = Typography;

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
