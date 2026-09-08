/**
 * `/showcase/components` — the shared components, demonstrated live (§60).
 *
 * The failure mode of a component showcase is that it becomes a *second copy*
 * of the thing it documents: a hand-written gallery that drifts from the
 * components as they change, and is then worse than no gallery because
 * somebody trusts it. Three decisions keep this one honest.
 *
 * **The inventory is derived from the directory, not typed here.**
 * `import.meta.glob` enumerates `src/components/*.tsx` at build time, so a
 * component added to that directory appears on this page the same day and one
 * that is deleted stops being documented. Only the *demonstrations* are
 * written by hand, because a component cannot be rendered without knowing what
 * to pass it.
 *
 * **The page says what it is not showing.** Every component in the inventory
 * with no demonstration is listed as such, with its file, and the coverage is
 * a number at the top. A gallery that quietly omitted three components would be
 * a gallery nobody could rely on — the omission is the fact worth publishing.
 *
 * **The demonstrations are the real components in real states**, not
 * screenshots and not prose. Each one shows the states that are decisions —
 * `StatCard`'s polarity, because "up" is good for revenue and bad for
 * response time; `EmptyState`'s two shapes; `StatusTag` across the
 * vocabularies it colours — because those are what somebody reusing it needs
 * to see, and a single happy-path example teaches none of them.
 *
 * The feature directories (`components/mail`, `components/kanban`, …) are
 * deliberately absent: those belong to their features and are demonstrated by
 * the pages that use them. This page is the *shared* toolkit, which is what
 * somebody building on the template reaches for.
 */

import { Alert, Card, Space, Table, Tag, Typography } from "antd";
import { InboxOutlined, SearchOutlined, WarningOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useMemo } from "react";

import { EmptyState } from "@/components/EmptyState";
import { ExportButton } from "@/components/ExportButton";
import { HighlightedText } from "@/components/HighlightedText";
import { PageHeader } from "@/components/PageHeader";
import { PersonAvatar } from "@/components/PersonAvatar";
import { StatCard } from "@/components/StatCard";
import { StatusTag } from "@/components/StatusTag";
import { formatNumber } from "@/lib/formats";

const { Text, Paragraph, Title } = Typography;

/**
 * Every shared component file, from the directory itself.
 *
 * Only the *names* are wanted, never the modules — the page imports what it
 * demonstrates by hand — so nothing here is eager and the glob costs no
 * behaviour.
 *
 * **The test files are excluded in the pattern, and that is not a style
 * choice.** The first version globbed `*.tsx` and filtered the names
 * afterwards, which is too late: Vite builds a dynamic import for every match
 * *before* any filter runs, so `ExportButton.test.tsx` entered the production
 * module graph and dragged MSW in with it. The build then failed outright —
 * which was lucky, because the quiet version of that mistake is a bundle that
 * builds and ships the mock server. `docs/RBAC.md` promises test fixtures are
 * excluded from the runtime graph; a glob is exactly how that promise gets
 * broken, so the exclusion belongs where Vite reads it.
 */
const FILES = import.meta.glob(["../../components/*.tsx", "!../../components/*.test.tsx"]);

/** The component names the directory contains, derived and sorted. */
export function inventory(paths: string[] = Object.keys(FILES)): string[] {
  return paths
    .map((path) => path.split("/").pop() ?? "")
    // Belt and braces: the glob already excludes these, and this keeps
    // `inventory` honest when it is called with paths in a test.
    .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
    .map((name) => name.replace(/\.tsx$/, ""))
    .sort();
}

/**
 * Which components this page actually demonstrates.
 *
 * Written by hand — a component cannot be rendered without knowing what to
 * pass it — and compared against the derived inventory below, so the gap is
 * published rather than hidden.
 */
const DEMONSTRATED = [
  "EmptyState",
  "ExportButton",
  "HighlightedText",
  "PageHeader",
  "PersonAvatar",
  "StatCard",
  "StatusTag",
] as const;

/**
 * What the page can and cannot show, as one fact.
 *
 * Returned as a value so it can be asserted directly: the test that matters is
 * the one saying every component in the directory is either demonstrated or
 * *listed as not*, because that is the property a drifting gallery loses.
 */
export function coverage(
  names: string[] = inventory(),
  shown: readonly string[] = DEMONSTRATED,
): { shown: string[]; missing: string[]; total: number } {
  const set = new Set(shown);
  return {
    shown: names.filter((name) => set.has(name)),
    missing: names.filter((name) => !set.has(name)),
    total: names.length,
  };
}

/** One demonstration: what it is, why its states matter, and the thing itself. */
function Demo({
  name,
  what,
  children,
}: {
  name: string;
  what: string;
  children: React.ReactNode;
}) {
  return (
    <Card size="small" className="nu-show-demo" data-testid={`demo-${name}`}>
      <div className="nu-show-head">
        <Text strong>{name}</Text>
        <Text type="secondary" className="nu-show-what">
          {what}
        </Text>
      </div>
      <div className="nu-show-stage">{children}</div>
    </Card>
  );
}

export default function ComponentsPage() {
  const found = useMemo(() => coverage(), []);

  const missingColumns: ColumnsType<{ name: string }> = [
    { title: "Component", dataIndex: "name" },
    {
      title: "Where it is",
      dataIndex: "name",
      render: (name: string) => (
        <Text type="secondary" className="nu-show-path">
          src/components/{name}.tsx
        </Text>
      ),
    },
  ];

  return (
    <div className="nu-show">
      <PageHeader
        title="Components"
        subtitle="The shared toolkit, rendered live. Feature components live with their features."
        tag={
          <Tag bordered={false}>
            {formatNumber(found.shown.length)} of {formatNumber(found.total)} demonstrated
          </Tag>
        }
      />

      {found.missing.length ? (
        <Alert
          type="warning"
          showIcon
          className="nu-show-gap"
          data-testid="coverage-gap"
          message={
            found.missing.length === 1
              ? "One shared component has no demonstration here"
              : `${found.missing.length} shared components have no demonstration here`
          }
          description={
            <>
              <Paragraph className="nu-show-gap-note">
                The inventory comes from the directory, so this list is what is
                genuinely missing rather than what somebody forgot to mention. A
                gallery that quietly omitted them would be one nobody could rely
                on.
              </Paragraph>
              <Table<{ name: string }>
                data-testid="missing-table"
                rowKey="name"
                size="small"
                pagination={false}
                dataSource={found.missing.map((name) => ({ name }))}
                columns={missingColumns}
              />
            </>
          }
        />
      ) : (
        <Alert
          type="success"
          showIcon
          className="nu-show-gap"
          data-testid="coverage-gap"
          message="Every shared component is demonstrated here."
          description="The inventory is read from src/components, so this stays true only while it is."
        />
      )}

      <Title level={4} className="nu-show-section">
        Numbers
      </Title>

      <Demo
        name="StatCard"
        what="A headline number. The states that matter are the two inputs a single 'trend' would have collapsed: which way it moved, and whether that is good news. A rise in open tickets and a rise in revenue are the same arrow and opposite facts."
      >
        <div className="nu-show-grid">
          <StatCard
            label="Open tickets"
            value={1284}
            trend="up"
            changePercent={12}
            polarity="down_is_good"
            hint="More is worse, so a rise reads as bad news."
          />
          <StatCard
            label="Revenue"
            value={482_000}
            unit="€"
            trend="up"
            changePercent={8}
            polarity="up_is_good"
            hint="More is better, so the same arrow reads as good."
          />
          <StatCard label="Devices" value={96} accent="info" hint="Nothing to compare against." />
          <StatCard
            label="Breaches"
            value={3}
            trend="down"
            changePercent={-40}
            polarity="down_is_good"
            accent="danger"
            hint="A fall in a bad thing is good news."
          />
        </div>
      </Demo>

      <Title level={4} className="nu-show-section">
        Chrome
      </Title>

      <Demo
        name="PageHeader"
        what="One header for every page: title, one line of context, a tag beside the title for a count or a state, and the actions on the right — in the same place on every screen, so the eye already knows where they are."
      >
        <div className="nu-show-inset">
          <PageHeader
            title="Tickets"
            subtitle="The support queue, oldest breach first."
            tag={<Tag bordered={false}>1 284 open</Tag>}
            actions={
              <ExportButton onExport={() => Promise.resolve()} label="Export" size="small" />
            }
          />
        </div>
      </Demo>

      <Demo
        name="ExportButton"
        what="Exports the question, not the page. A refusal for size becomes an offer to queue it instead (§30), which is why the caller passes two functions rather than one."
      >
        <Space>
          <ExportButton onExport={() => Promise.resolve()} />
          <ExportButton onExport={() => Promise.resolve()} disabled label="Nothing to export" />
        </Space>
      </Demo>

      <Title level={4} className="nu-show-section">
        Emptiness
      </Title>

      <Demo
        name="EmptyState"
        what="Two shapes, because there are two empty states: nothing yet — which says what would appear and offers the action — and no results, which says what is filtered. A shared 'no data' would answer neither."
      >
        <div className="nu-show-pair">
          <div className="nu-show-inset">
            <EmptyState
              title="No tickets yet"
              hint="When somebody writes in, their ticket appears here."
              icon={<InboxOutlined />}
            />
          </div>
          <div className="nu-show-inset">
            <EmptyState
              compact
              title="Nothing matches"
              hint="Two filters are narrowing this list."
              icon={<SearchOutlined />}
            />
          </div>
        </div>
      </Demo>

      <Title level={4} className="nu-show-section">
        Values
      </Title>

      <Demo
        name="StatusTag"
        what="One colour per meaning across every vocabulary the platform has, decided once — so OPEN means the same shade on a ticket, an order and a job, and a reader learns the palette once."
      >
        <Space wrap>
          {[
            "OPEN",
            "IN_PROGRESS",
            "RESOLVED",
            "CLOSED",
            "BLOCKED",
            "FAILED",
            "SUCCEEDED",
            "CANCELLED",
            "DRAFT",
            "ACTIVE",
          ].map((value) => (
            <StatusTag key={value} status={value} />
          ))}
        </Space>
      </Demo>

      <Demo
        name="PersonAvatar"
        what="Initials when there is no picture, and a label only when the avatar is the sole thing identifying somebody — a name beside it makes the label a repetition a screen reader has to hear twice."
      >
        <Space>
          <PersonAvatar name="Ada Administrator" initials="AA" />
          <PersonAvatar name="Mara Manager" initials="MM" />
          <PersonAvatar name="Otto Operator" initials="OO" label />
          <PersonAvatar name={null} initials={null} />
        </Space>
      </Demo>

      <Demo
        name="HighlightedText"
        what="Marks the term that was actually searched for. Splitting is a pure function, so the highlighting cannot disagree with the match — and it marks nothing when the term is empty rather than marking everything."
      >
        <div className="nu-show-lines">
          <HighlightedText text="Printer on fire in the north wing" term="fire" />
          <HighlightedText text="Printer on fire in the north wing" term="" />
          <HighlightedText text="No match for this one" term="zebra" />
        </div>
      </Demo>

      <Alert
        type="info"
        showIcon
        icon={<WarningOutlined />}
        className="nu-show-note"
        data-testid="feature-note"
        message="Feature components are demonstrated by their features"
        description="components/mail, components/kanban, components/explorer and the rest belong to one page each. Putting them here would mean maintaining a second set of props for them, which is exactly how a showcase starts lying."
      />
    </div>
  );
}
