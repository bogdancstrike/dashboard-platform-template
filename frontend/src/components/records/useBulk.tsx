import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Space, Tooltip, Typography } from "antd";
import { ColumnWidthOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import type { BulkAction, BulkSelection } from "@/api/bulk";
import type { ExplorerRequest, ExplorerResource } from "@/api/explorer";
import { BulkDialog, settableFields } from "@/components/records/BulkDialog";
import { formatNumber } from "@/lib/formats";

/**
 * The most records a comparison may hold — `compare.MAX_RECORDS` on the server.
 *
 * Named here rather than fetched, because it decides whether a *control* is
 * offered: a Compare button that appears and then hands back a refusal is worse
 * than one that is absent, and the number is a reading limit rather than a
 * deployment setting.
 */
const COMPARE_LIMIT = 5;

const { Text } = Typography;

/**
 * Selecting many rows and doing one thing to them (§43, §75).
 *
 * Lives here rather than in each list for the reason `useRecordEditing`
 * documents: the six entity pages share no layout on purpose, and what they do
 * share is the contract. A page decides where the bar goes; it does not decide
 * what "selected" means, what a bulk edit may set, or whether a preview is
 * shown.
 *
 * Two decisions are worth the reader's attention.
 *
 * **A selection can be larger than the page.** Ticking the header box selects
 * the twenty-five rows on screen, which is almost never what somebody means
 * when a filter matches four hundred. So the bar offers the *question* as a
 * selection — "select all 412 matching this filter" — and sends it as the
 * list's own request rather than as four hundred ids. `excluded` carries the
 * rows unticked afterwards, because "all of these except that one" is a thing
 * people do and four hundred and eleven ids is not how to say it.
 *
 * **The refusal is on the button, not after it.** A reader who cannot delete
 * sees a disabled button naming the permission (§76), rather than a dialog
 * that takes their confirmation and then refuses.
 */

export interface Bulk {
  /** Spread onto an AntD `<Table rowSelection={…}>`. */
  rowSelection: {
    selectedRowKeys: string[];
    onChange: (keys: React.Key[]) => void;
    preserveSelectedRowKeys: true;
  };
  /** The bar, rendered by the page wherever it belongs. Null when nothing is selected. */
  bar: ReactNode;
  /** Rendered once per page. */
  dialog: ReactNode;
  /** How many records the gesture would cover, as the reader understands it. */
  count: number;
  clear: () => void;
}

export function useBulk(
  resource: ExplorerResource | undefined,
  options: {
    /** The list's own request — what "everything matching" means. */
    request: ExplorerRequest | null;
    /** The server's count for that request, for the "select all N" offer. */
    total: number;
  },
): Bulk {
  const { request, total } = options;
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();

  const [ticked, setTicked] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [action, setAction] = useState<BulkAction | null>(null);

  // The *resource's* own flags, not the profile's permission list, and for the
  // same reason `useRecordEditing` reads them: the server has already decided
  // what this caller may do with this dataset, and a second opinion computed
  // in the browser is how a page comes to offer a single delete while
  // refusing a bulk one.
  const canDelete = resource?.can_delete ?? false;
  const canUpdate = (resource?.can_edit ?? false) && settableFields(resource).length > 0;

  const clear = () => {
    setTicked([]);
    setAllMatching(false);
    setExcluded([]);
  };

  /**
   * Whether these records can be put side by side (§47).
   *
   * Only a hand-picked selection, and only a small one. "Compare everything
   * matching this filter" is not a question anybody asks — a comparison is
   * read across, so five columns is already the most a page can carry, and the
   * server refuses more.
   */
  const comparable = !allMatching && ticked.length >= 2 && ticked.length <= COMPARE_LIMIT;

  // Both halves are sent when both are in play, and that is what makes the
  // preview's split mean anything: a reader who ticked three rows and then
  // said "also everything matching" has made two different decisions, and the
  // server reports them separately because they are trusted differently.
  // Dropping the ids here left `by_hand` at nought and the split invisible.
  const selection: BulkSelection = allMatching
    ? { ids: ticked, query: request, excluded }
    : { ids: ticked };

  const count = allMatching ? Math.max(total - excluded.length, 0) : ticked.length;

  const rowSelection = {
    selectedRowKeys: ticked,
    // Every tick box says what it selects. AntD names the header's "Select
    // all" and leaves the rows unnamed, so a screen reader reads a column of
    // twenty-five identical "checkbox"es — which axe reports as a missing
    // label and a reader experiences as a table they cannot select from.
    getCheckboxProps: (row: Record<string, unknown>) => ({
      "aria-label": `Select ${nameOf(row, resource)}`,
    }),
    // `preserveSelectedRowKeys` so a selection survives paging: a reader who
    // ticks four rows, turns the page and ticks two more means six, and a
    // table that forgets the first four silently applies the change to two.
    preserveSelectedRowKeys: true as const,
    onChange: (keys: React.Key[]) => {
      const next = keys.map(String);
      setTicked(next);
      if (allMatching) {
        // Unticking inside a filter selection is an exclusion, not a new
        // selection: the reader is still saying "everything matching, except".
        const shown = new Set(next);
        setExcluded((current) => [...new Set([...current, ...ticked.filter((id) => !shown.has(id))])]);
      }
    },
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["entity-rows"] });
    void queryClient.invalidateQueries({ queryKey: ["entity-insights"] });
    void queryClient.invalidateQueries({ queryKey: ["task-lane"] });
  };

  // Not memoised, deliberately: it is a dozen nodes that depend on nearly
  // every piece of state here, and a dependency list that long is a list that
  // goes stale. A suppressed exhaustive-deps warning would be the tell.
  const bar = ((): ReactNode => {
    if (count === 0) return null;
    const noun = count === 1
      ? (resource?.label ?? "record").replace(/s$/, "").toLowerCase()
      : (resource?.label ?? "records").toLowerCase();

    return (
      <div className="nu-bulkbar" role="region" aria-label="Selected records" data-testid="bulk-bar">
        <Space size={10} wrap>
          <Text strong data-testid="bulk-count">
            {formatNumber(count)} {noun} selected
          </Text>
          {/* The offer that makes a selection larger than the page. Shown only
              when there is more to select than is on screen, because an offer
              to select the four rows already ticked is noise. */}
          {!allMatching && request && total > ticked.length && (
            <Button
              type="link"
              size="small"
              onClick={() => {
                setAllMatching(true);
                setExcluded([]);
              }}
              data-testid="bulk-select-all"
            >
              Select all {formatNumber(total)} matching this filter
            </Button>
          )}
          {allMatching && excluded.length > 0 && (
            <Text type="secondary">{formatNumber(excluded.length)} taken out</Text>
          )}
        </Space>

        <Space size={8} wrap>
          <Tooltip title={canUpdate ? "" : updateRefusal(resource)}>
            <Button
              size="small"
              icon={<EditOutlined />}
              disabled={!canUpdate}
              onClick={() => setAction("update")}
              data-testid="bulk-update"
            >
              Change a field
            </Button>
          </Tooltip>
          <Tooltip title={canDelete ? "" : "Your role does not include records.delete"}>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={!canDelete}
              onClick={() => setAction("delete")}
              data-testid="bulk-delete"
            >
              Delete
            </Button>
          </Tooltip>
          {/* Only when a comparison is possible, and it is a *link* rather
              than a button because it navigates: a reader can middle-click it
              to keep the list open. */}
          {comparable && resource && (
            <Link
              to={`/compare?type=${resource.key}&ids=${ticked.join(",")}`}
              data-testid="bulk-compare"
            >
              <Button size="small" icon={<ColumnWidthOutlined />}>
                Compare {formatNumber(ticked.length)}
              </Button>
            </Link>
          )}
          <Button size="small" type="text" onClick={clear} data-testid="bulk-clear">
            Clear
          </Button>
        </Space>
      </div>
    );
  })();

  return {
    rowSelection,
    bar,
    count,
    clear,
    dialog: (
      <BulkDialog
        open={action !== null}
        action={action ?? "update"}
        resource={resource}
        selection={selection}
        onClose={() => setAction(null)}
        onApplied={(applied) => {
          if (applied > 0) message.success(`${formatNumber(applied)} changed`);
          refresh();
          clear();
        }}
      />
    ),
  };
}

/**
 * Whether a click on a table row means "open this record".
 *
 * It does not when the click landed on a control: a checkbox, a button, a link
 * or a menu trigger. Adding row selection to a table whose rows navigate on
 * click made ticking a box *open the record* — the click bubbled to the row
 * and the reader lost the page they were selecting on. Found by the first test
 * that tried to tick one.
 *
 * Read off the DOM rather than by stopping propagation in every cell: a table
 * has one row handler and a dozen kinds of control in it, and the rule "a
 * control's click belongs to the control" is one sentence in one place.
 *
 * Takes the *target* rather than the event: AntD types `onRow`'s handler with
 * `MouseEvent<any>`, and a parameter narrower than that is an unsafe argument.
 * The target is all this needs, and it is typed.
 */
export function opensRecord(target: EventTarget | null): boolean {
  return !(target instanceof Element
    ? target.closest(
        ".ant-table-selection-column, .ant-checkbox-wrapper, button, a, [role='button']",
      )
    : null);
}

/**
 * What to call one row out loud.
 *
 * The *reference* first, where a dataset has one: "Select TIC-00042" is what
 * somebody would say, and it is short enough to hear twenty-five times. The
 * declared title is the fallback, and the order after that mirrors the
 * server's own `label_for` so the spoken name and the audited name agree.
 */
function nameOf(row: Record<string, unknown>, resource: ExplorerResource | undefined): string {
  for (const name of [
    resource?.subtitle_field,
    "reference",
    "code",
    resource?.title_field,
    "name",
  ]) {
    const value = name ? row[name] : undefined;
    if (typeof value === "string" && value) return value;
  }
  return "this row";
}

/** Why the change button is off — the permission, or the dataset (§76). */
function updateRefusal(resource: ExplorerResource | undefined): string {
  if (!resource?.can_edit) return "Your role does not include records.update";
  return `${resource.label} has no field a bulk change can set`;
}
