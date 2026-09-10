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
 * **Two shelves, and they promise different things.** The *shared toolkit*
 * (`components/*.tsx`) is what somebody building on the template reaches for,
 * and every one of them is either demonstrated here or listed as not. The
 * *feature components* (`components/mail`, `components/kanban`, …) belong to
 * their own features, so the page shows a chosen few — the ones whose shape is
 * worth borrowing — and says plainly that it is a selection rather than an
 * inventory. Claiming coverage of a hundred feature components would be a
 * promise this page could not keep.
 */

import { Alert, Button, Card, Segmented, Space, Table, Tag, Typography } from "antd";
import { InboxOutlined, SearchOutlined, WarningOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import type { ChartPanel } from "@/api/dashboard";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ChartCard } from "@/components/ChartCard";
import { EdgeTag } from "@/components/EdgeTag";
import { EmptyState, NoResults } from "@/components/EmptyState";
import { FailureAlert } from "@/components/FailureAlert";
import { NameModal } from "@/components/NameModal";
import { ExportButton } from "@/components/ExportButton";
import { HighlightedText } from "@/components/HighlightedText";
import { PageHeader } from "@/components/PageHeader";
import { PersonAvatar } from "@/components/PersonAvatar";
import {
  ERROR_SLUGS,
  PROBLEMS,
  PROBLEM_KINDS,
} from "@/components/ProblemPage";
import { StatCard } from "@/components/StatCard";
import { StatusTag } from "@/components/StatusTag";
import { formatNumber } from "@/lib/formats";
import { SERIES } from "@/theme/tokens";
import type { AuditChange } from "@/api/audit";
import type { DashboardWidget } from "@/api/dashboards";
import type { KanbanCard, KanbanLane } from "@/api/kanban";
import type { Tag as RecordTag } from "@/api/tags";
import { AuditDiff } from "@/components/audit/AuditDiff";
import { ChartKindStrip } from "@/components/charts/ChartKindStrip";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { WidgetCard, type WidgetMoves } from "@/components/dashboards/WidgetCard";
import { KanbanCardTile } from "@/components/kanban/KanbanCardTile";
import { TagChip } from "@/components/records/TagPicker";
import { PeoplePicker } from "@/components/PeoplePicker";
// Tag colours from the palette, like every other colour in the product: a
// demonstration that wrote its own hexes would be a demonstration of the one
// rule this file exists to keep.
import { SEMANTIC } from "@/theme/tokens";

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
  "AutoRefresh",
  "ChartCard",
  "CommandPalette",
  "EdgeTag",
  "EmptyState",
  "ExportButton",
  "FailureAlert",
  "HighlightedText",
  "NameModal",
  "PageHeader",
  "PeoplePicker",
  "PersonAvatar",
  "ProblemPage",
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

/** The four failure kinds, in the order they lead somewhere different. */
const FAILURES: { status: number; title: string }[] = [
  { status: 500, title: "Those records could not be loaded" },
  { status: 403, title: "Your role does not include this dataset" },
  { status: 404, title: "That record is no longer there" },
  { status: 409, title: "Somebody else changed this first" },
];

/**
 * The feature components this page shows, and why each earns a place.
 *
 * A *selection*: there are a hundred of them across mail, kanban, explorer and
 * the rest, each with props only its own page knows how to fill. What is here
 * is the ones whose shape somebody building on the template would want to
 * borrow — and the page says so rather than implying coverage it cannot keep.
 */
const FEATURE_DEMOS = [
  "WidgetCard",
  "KanbanCardTile",
  "ChartPreview",
  "ChartKindStrip",
  "TagChip",
  "AuditDiff",
] as const;

/** A widget with no question behind it — the frame is the subject here. */
const DEMO_WIDGET: DashboardWidget = {
  id: "demo",
  kind: "BAR_CHART",
  title: "Tickets by severity",
  subtitle: "Last 30 days",
  x: 0,
  y: 0,
  width: 4,
  height: 2,
  position: 0,
  config: { entity: "ticket" },
};

/** A card in a preview cannot be moved, so the moves are refused rather than absent. */
const NO_MOVES: WidgetMoves = {
  nudge: () => {},
  resize: () => {},
  setSize: () => {},
  edit: () => {},
  remove: () => {},
};

const DEMO_LANE: KanbanLane = {
  id: "lane-demo",
  name: "In progress",
  position: 1,
  wip_limit: 3,
  is_done: false,
  total: 4,
  over_limit: true,
  cards: [],
};

/** Enough facts to show the tile's rules, and no more — that *is* the rule. */
const DEMO_CARD: KanbanCard = {
  id: "card-demo",
  board_id: "board-demo",
  lane_id: "lane-demo",
  reference: "PLAT-00042",
  kind: "BUG",
  title: "Export times out above 50 000 rows",
  description: null,
  parent_id: null,
  position: 0,
  priority: "HIGH",
  story_points: 5,
  assignee: { id: "user-1", name: "Ada Administrator", initials: "AA" },
  labels: ["exports", "performance"],
  due_date: "2026-09-04T09:00:00Z",
  started_at: null,
  completed_at: null,
  checklist: [
    { text: "Reproduce", done: true },
    { text: "Fix", done: false },
  ],
  checklist_done: 1,
  comment_count: 2,
  created_at: "2026-08-20T09:00:00Z",
  updated_at: "2026-09-01T09:00:00Z",
};

/** Three tags across three categories, so the edge colour has work to do. */
const DEMO_TAGS: RecordTag[] = [
  {
    id: "tag-1",
    name: "urgent",
    slug: "urgent",
    category: "PRIORITY",
    color: SEMANTIC.danger,
    description: "Needs attention today",
    usage_count: 12,
    is_system: true,
  },
  {
    id: "tag-2",
    name: "documentation",
    slug: "documentation",
    category: "ENGINEERING",
    color: SEMANTIC.info,
    description: "",
    usage_count: 8,
    is_system: false,
  },
  {
    id: "tag-3",
    name: "emea",
    slug: "emea",
    category: "REGION",
    color: SEMANTIC.warning,
    description: "",
    usage_count: 30,
    is_system: false,
  },
];

/** One of each kind of change, which is the point of the component. */
const DEMO_CHANGES: AuditChange[] = [
  { field: "status", from: "IN_PROGRESS", to: "BLOCKED", kind: "changed" },
  { field: "assignee", from: null, to: "Mara Manager", kind: "added" },
  { field: "due_date", from: "2026-09-04", to: null, kind: "cleared" },
];

/** A panel of the shape the analysis endpoints return. */
const DEMO_PANEL: ChartPanel = {
  kind: "bar",
  title: "Tickets by severity",
  series: [
    { name: "CRITICAL", value: 4 },
    { name: "HIGH", value: 11 },
    { name: "NORMAL", value: 26 },
    { name: "LOW", value: 7 },
  ],
};

/** The six states every list has, and why each is its own state (§34). */
const TABLE_STATES = [
  {
    key: "rows",
    label: "Rows",
    why: "The ordinary case: a page of the answer, with the whole dataset's count in the header.",
  },
  {
    key: "loading",
    label: "Loading",
    why: "A skeleton in the final layout, never a centred spinner: a spinner says the page is busy, a skeleton says what is about to be there.",
  },
  {
    key: "nothing",
    label: "Nothing yet",
    why: "An empty dataset, so it offers the action that makes the first row — and says nothing about filters, because none are set.",
  },
  {
    key: "no-match",
    label: "Nothing matched",
    why: "A bad question rather than an empty system: it says how many filters are narrowing the list and clears them in one click.",
  },
  {
    key: "error",
    label: "Failed",
    why: "What failed, the id to quote, and a retry — because a fault is worth trying again.",
  },
  {
    key: "forbidden",
    label: "Refused",
    why: "The permission named in words, and no retry: a refusal does not become permission on a second press.",
  },
] as const;

type TableState = (typeof TABLE_STATES)[number]["key"];

/** Three rows of the shape a list draws. Enough to show the chrome. */
const DEMO_ROWS = [
  { id: "1", reference: "TIC-00041", title: "Printer on fire", status: "OPEN" },
  { id: "2", reference: "TIC-00042", title: "Export finishes empty", status: "IN_PROGRESS" },
  { id: "3", reference: "TIC-00043", title: "Login loops on Safari", status: "RESOLVED" },
];

const DEMO_COLUMNS: ColumnsType<(typeof DEMO_ROWS)[number]> = [
  { title: "Reference", dataIndex: "reference", sorter: true, width: 140 },
  { title: "Title", dataIndex: "title" },
  {
    title: "Status",
    dataIndex: "status",
    width: 140,
    render: (value: string) => <StatusTag status={value} />,
  },
];

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
  const [naming, setNaming] = useState(false);
  const [named, setNamed] = useState("");
  const [tableState, setTableState] = useState<TableState>("rows");
  /** The widget tile has two states, and the difference is the demonstration. */
  const [widgetEditing, setWidgetEditing] = useState(false);
  const [chartKind, setChartKind] = useState("bar");
  const [people, setPeople] = useState<string[]>([]);

  /**
   * The table, in the state the reader chose.
   *
   * The real components in each case — `NoResults`, `EmptyState`,
   * `FailureAlert` — rather than a picture of them, because a showcase drawn
   * from copies is the thing this page's docstring warns about.
   */
  const tableStage = (state: TableState) => {
    if (state === "error" || state === "forbidden") {
      return (
        <FailureAlert
          error={
            new ApiError(
              state === "error" ? 500 : 403,
              {
                error: "demo",
                message: "The server's own sentence about what happened.",
                details: state === "forbidden" ? { missing: ["records.view"] } : {},
              },
              "b7f2c1a9-demo",
            )
          }
          titles={{
            failed: "Those records could not be loaded",
            forbidden: "Your role does not include this dataset",
          }}
          onRetry={() => undefined}
        />
      );
    }
    return (
      <Table<(typeof DEMO_ROWS)[number]>
        size="small"
        rowKey="id"
        loading={state === "loading"}
        rowSelection={{
          selectedRowKeys: state === "rows" ? ["2"] : [],
          // Named, as the real lists name them (`useBulk`): a column of
          // unlabelled checkboxes is thirty violations and a screen reader
          // saying "checkbox" forty times (§55).
          getCheckboxProps: (row) =>
            ({ "aria-label": `Select ${row.reference}` }) as Record<string, string>,
        }}
        dataSource={state === "rows" ? DEMO_ROWS : []}
        columns={DEMO_COLUMNS}
        pagination={{
          current: 1,
          pageSize: 25,
          total: state === "rows" ? 1284 : 0,
          showSizeChanger: true,
          showTotal: (total) => `${formatNumber(total)} matching`,
        }}
        locale={{
          emptyText:
            state === "loading" ? (
              <> </>
            ) : state === "no-match" ? (
              <NoResults filterCount={2} onClear={() => undefined} />
            ) : (
              <EmptyState
                title="No tickets yet"
                hint="A ticket is a customer's problem with a deadline attached."
                action={<Button size="small">New ticket</Button>}
              />
            ),
        }}
      />
    );
  };

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

      <Demo
        name="ProblemPage"
        what="The six ways a page can fail to appear (§34). Each says what happened and what to do about it, in that order, and carries the correlation id — which is the only thing on the page somebody else can act on. Whether a retry appears is declared per kind, so a 404 cannot be given a button that fails identically on the second press."
      >
        <div className="nu-show-lines">
          {PROBLEM_KINDS.map((kind) => (
            <Link key={kind} to={`/errors/${ERROR_SLUGS[kind]}`}>
              {PROBLEMS[kind].title} — /errors/{ERROR_SLUGS[kind]}
            </Link>
          ))}
          <Text type="secondary">
            Rendered full-page rather than inline: each is an address, because two
            of them cannot be reached by asking.
          </Text>
        </div>
      </Demo>

      <Title level={4} className="nu-show-section">
        Failure, and how current a page is
      </Title>

      <Demo
        name="FailureAlert"
        what="The failure state, once, for every data view that has one (§34). Four kinds that lead somewhere different: a refusal and a stale write are warnings because they are answers, a fault is an error. The permission is named in the same words a disabled control uses, the correlation id is always there and always copyable, and a retry appears only where trying again could work — a 'Try again' on a 404 promises the address will resolve on the second press."
      >
        <div className="nu-show-lines">
          {FAILURES.map(({ status, title }) => (
            <FailureAlert
              key={status}
              error={
                new ApiError(
                  status,
                  {
                    error: "demo",
                    message: "The server's own sentence about what happened.",
                    details: status === 403 ? { missing: ["records.update"] } : {},
                  },
                  "b7f2c1a9-demo",
                )
              }
              titles={{ not_found: title, forbidden: title, conflict: title, failed: title }}
              onRetry={() => undefined}
            />
          ))}
        </div>
      </Demo>

      <Demo
        name="AutoRefresh"
        what="How old what is on screen is, and how often to ask again (§53). Off by default — a page that polls on a timer nobody asked for spends the database's time on a tab somebody left open — and parked while the tab is hidden. A split control, because 'reload it now' is one press and 'keep reloading it' is a decision made once."
      >
        <Space size={16} wrap>
          <AutoRefresh page="showcase" refresh={() => undefined} updatedAt={Date.now() - 240_000} />
          {/* Deliberately *not* a `busy` example: the icon spins while a
              request is in flight, and an example that spins for ever is both
              a lie and a page whose animations never settle — which is what
              every accessibility sweep in this suite waits for. */}
          <Text type="secondary">
            While a request is in flight it says “Refreshing…” and the icon
            spins.
          </Text>
        </Space>
      </Demo>

      <Demo
        name="NameModal"
        what="The plain modal, for a create whose whole decision is one word (§33). Enter submits, an empty name is refused in words rather than closing and creating nothing, and the value is trimmed — three defects the two places that asked one question with a confirm dialog each had."
      >
        <Space direction="vertical">
          <Button onClick={() => setNaming(true)} data-testid="demo-name-modal">
            New folder…
          </Button>
          <Text type="secondary">
            {named ? `Last name given: ${named}` : "Nothing named yet."}
          </Text>
          <NameModal
            open={naming}
            title="New folder"
            label="Folder name"
            placeholder="Contracts"
            onClose={() => setNaming(false)}
            onSubmit={(value) => {
              setNamed(value);
              setNaming(false);
            }}
          />
        </Space>
      </Demo>

      <Title level={4} className="nu-show-section">
        Data
      </Title>

      <Demo
        name="EdgeTag"
        what="A chip whose colour comes from the *data* rather than from a palette choice at the call site — a tag's hue is the thing it names, so the same status is the same colour on every page. The ink is measured against its own ground (§55), which a hex handed to AntD's `color` is not."
      >
        <Space wrap>
          {/* From the series palette rather than four hexes written here: a
              colour literal outside `src/theme` is exactly what
              `theme/palette.test.ts` refuses, and a showcase is not exempt
              from the rule it is demonstrating. */}
          {["Backend", "Shipped", "Blocked", "Design"].map((label, index) => (
            <EdgeTag key={label} color={SERIES[index % SERIES.length]}>
              {label}
            </EdgeTag>
          ))}
        </Space>
      </Demo>

      <Demo
        name="ChartCard"
        what="A chart that can always be read as a table (§30). Charts are for shape and tables are for 'what exactly was the number on the 14th', so every panel offers both from the same data, remembers which one was chosen, and exports the same rows. A panel whose query failed says so rather than falling through to 'Nothing in this period', which is a finding and not a state."
      >
        <div className="nu-show-grid nu-show-grid--wide">
          <ChartCard id="showcase-bars" height={180} panel={DEMO_PANEL} />
          <ChartCard
            id="showcase-empty"
            height={180}
            panel={{ ...DEMO_PANEL, series: [] }}
            empty={{ title: "Nothing in this period", hint: "The question was fine." }}
          />
        </div>
      </Demo>

      <Title level={4} className="nu-show-section">
        The data table, and the states it must have
      </Title>

      <Alert
        type="info"
        showIcon
        className="nu-show-note"
        data-testid="table-note"
        message="One table, six states (§3, §34)"
        description="Every list in the platform is one AntD table over a server-side query: filtering, sorting, paging, faceting and column choice all happen in PostgreSQL from one field declaration, so the header's count is the whole dataset rather than the page. What is worth demonstrating on its own is the part a screenshot of a happy path never shows — the states, and which of the two empties a reader is looking at."
      />

      <Demo
        name="Data table"
        what="Switch between the states. The loading one is a skeleton in the final layout rather than a centred spinner, because a spinner says the page is busy and a skeleton says what is about to be there; and the two empties are deliberately different — 'nothing yet' wants the action that makes the first row, 'nothing matched' wants the filters cleared."
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Segmented
            size="small"
            value={tableState}
            onChange={(next) => setTableState(next)}
            options={TABLE_STATES.map((state) => ({ value: state.key, label: state.label }))}
            data-testid="table-state"
          />
          <Text type="secondary">{TABLE_STATES.find((s) => s.key === tableState)?.why}</Text>
          <div data-testid="table-stage">{tableStage(tableState)}</div>
        </Space>
      </Demo>

      <Demo
        name="PeoplePicker"
        what="Choosing colleagues, searched on the server. The list is never filtered again in the browser — the server has already decided who this reader may see, and filtering the answer a second time would hide the person they just searched for. An option carries the face, the name and the role, because two people called Ana are told apart by the third."
      >
        <div style={{ maxWidth: 340 }}>
          <PeoplePicker value={people} onChange={setPeople} />
        </div>
      </Demo>

      <Demo
        name="CommandPalette"
        what="Every action on the page, by name (§54). Opened with ⌘K or Ctrl-K from anywhere; what it lists is whatever the current page registered plus the navigation this role may reach, so it is never a menu of things that would refuse."
      >
        <Space direction="vertical" size={8}>
          {/* The real shortcut, dispatched — not a second copy of the palette
              and not a context this page reaches into. The shell already
              mounts one, and demonstrating the *gesture* is more honest than
              demonstrating a duplicate that would race it for the hotkey. */}
          <Button
            onClick={() =>
              window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
              )
            }
            data-testid="open-palette"
          >
            Open it
          </Button>
          <Text type="secondary">
            Or press <Text keyboard>⌘K</Text> anywhere in the platform.
          </Text>
        </Space>
      </Demo>

      {/* ── the second shelf ─────────────────────────────────────────────
          Components that belong to one feature each, shown because their
          *shape* is worth borrowing — a card that fills a grid cell, a tile
          that reads at a glance, a diff that says what changed. Announced as a
          selection rather than an inventory: this page can promise coverage of
          the shared toolkit and cannot promise it of a hundred feature
          components, and claiming otherwise is how a showcase starts lying. */}
      <div className="nu-show-shelf" data-testid="feature-shelf">
        <Title level={4}>From the features</Title>
        <Paragraph type="secondary">
          A selection, not an inventory — {FEATURE_DEMOS.length} of the components that belong to
          one page each, chosen because their shape is worth borrowing. Every one of them is the
          real component with real props.
        </Paragraph>
      </div>

      <Demo
        name="WidgetCard"
        what="A dashboard tile: the frame, the controls that appear only while the layout can change, and a body that scrolls inside a fixed height. In reading mode it carries its kind's icon; in editing mode the heading becomes a drag handle and three controls appear."
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Segmented
            size="small"
            value={widgetEditing ? "editing" : "reading"}
            onChange={(next) => setWidgetEditing(next === "editing")}
            options={[
              { value: "reading", label: "Reading" },
              { value: "editing", label: "Rearranging" },
            ]}
            data-testid="widget-mode"
          />
          <div style={{ maxWidth: 380, height: 190 }}>
            <WidgetCard
              widget={DEMO_WIDGET}
              editable={widgetEditing}
              columns={12}
              moves={NO_MOVES}
            >
              <ChartPreview panel={DEMO_PANEL} height={120} />
            </WidgetCard>
          </div>
        </Space>
      </Demo>

      <Demo
        name="KanbanCardTile"
        what="A board card. Only the facts that are *there* — a tile with five empty slots says nothing about a card that has none of them — and the kind is a coloured edge rather than a coloured tile, because a tinted card behind body text is a contrast failure and cannot then also use colour for priority."
      >
        <div style={{ maxWidth: 300 }}>
          <KanbanCardTile
            card={DEMO_CARD}
            canEdit
            lanes={[DEMO_LANE]}
            currentLane={DEMO_LANE}
            index={0}
            laneSize={3}
            onOpen={() => {}}
            onDropBefore={() => {}}
            onHoverAt={() => {}}
            onCarry={() => {}}
            onMoveWithin={() => {}}
            onMoveToLane={() => {}}
          />
        </div>
      </Demo>

      <Demo
        name="ChartPreview"
        what="A chart with no chrome, drawn in a theme it is told to use. The mode is a prop rather than the reader's own setting, which is the whole reason it exists: a chart checked only in the appearance its author happens to use is a chart nobody checked in the other one — and half the readers are in the other one."
      >
        <div className="nu-show-pair">
          <ChartPreview panel={DEMO_PANEL} mode="light" height={150} label="Light" />
          <ChartPreview panel={DEMO_PANEL} mode="dark" height={150} label="Dark" />
        </div>
      </Demo>

      <Demo
        name="ChartKindStrip"
        what="Which picture to draw, as a strip rather than a select. Thirteen shapes are a thing somebody browses — the icons are the vocabulary — and a dropdown hides twelve of them behind a click."
      >
        <ChartKindStrip
          kinds={["bar", "line", "area", "pie", "treemap", "heatmap"]}
          value={chartKind}
          onChange={setChartKind}
        />
      </Demo>

      <Demo
        name="TagChip"
        what="One tag, coloured on its leading edge and never as a fill. AntD writes white on a custom colour without measuring, and white on this palette's amber is 2.87:1 — so the colour identifies and the ink stays readable (§55)."
      >
        <Space size={6} wrap>
          {DEMO_TAGS.map((tag) => (
            <TagChip key={tag.id} tag={tag} listPath="/tasks" />
          ))}
        </Space>
      </Demo>

      <Demo
        name="AuditDiff"
        what="What one change actually changed, field by field. Added, removed and altered are three different rows rather than three shades of one, and a value nobody set reads as “not set” rather than as an empty cell that could be either."
      >
        <AuditDiff changes={DEMO_CHANGES} />
      </Demo>

      <Alert
        type="info"
        showIcon
        icon={<WarningOutlined />}
        className="nu-show-note"
        data-testid="feature-note"
        message="The second shelf is a selection, not an inventory"
        description="The shared toolkit above is complete — every component in components/ is demonstrated or listed as missing. The feature components are chosen: there are a hundred of them across mail, kanban, explorer, dashboards and the rest, each with props that only its own page knows how to fill, and a gallery claiming to cover them all would be one nobody could rely on."
      />
    </div>
  );
}
