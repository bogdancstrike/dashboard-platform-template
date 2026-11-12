/**
 * The advanced-search workspace (§4, §51).
 *
 * The condition being edited here is a *draft*. The page behind the drawer
 * keeps showing the last question that was actually run, and the draft becomes
 * that question when **Search** is pressed — closing the drawer without
 * pressing it leaves the results exactly as they were.
 *
 * That split is what lets both halves of §4 be true at once: a live match count
 * as the tree is edited, without the page underneath churning through every
 * half-built rule on the way to a finished question. The count comes from a
 * debounced preview of the draft, run by the same endpoint that will run the
 * search — so the number on the button is the number of rows that arrive.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Collapse, Drawer, Select, Space, Tooltip, Typography } from "antd";
import {
  ApartmentOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons";

import { explorerApi, type ExplorerField, type ExplorerRequest, type ExplorerResource } from "@/api/explorer";
import { URL_OVERLAY } from "@/app/history";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSticky } from "@/hooks/useSticky";

import { DescribeFilters } from "@/components/assistant/DescribeFilters";

import { ConditionBuilder } from "./ConditionBuilder";
import { countRules, emptyTree, type QueryNode } from "./queryTree";

const { Text, Paragraph } = Typography;

export interface AdvancedSearchDrawerProps {
  open: boolean;
  /** The catalogue for the dataset being explored. */
  fields: ExplorerField[];
  /** The question currently on screen; the draft starts as a copy of its tree. */
  request: ExplorerRequest;
  onClose: () => void;
  /** Run the draft: it becomes the page's question. */
  onSearch: (tree: QueryNode | null) => void;
  /** Save the draft under a name, without having to run it first. */
  onSave: (tree: QueryNode | null) => void;
  /** What the dataset is called and how big it is, for the header. */
  datasetLabel?: string;
  recordCount?: number;
  /** Open the saved-search panel ("Load a saved search"). */
  onOpenSaved?: () => void;
  /** Every dataset this reader may explore, for "Find [dataset] where …". */
  resources?: ExplorerResource[];
  /** Switch the page's dataset; the draft starts again, empty. */
  onChooseResource?: (key: string) => void;
}

export function AdvancedSearchDrawer(props: AdvancedSearchDrawerProps) {
  return (
    <Drawer
      open={props.open}
      // Wider than it was. A condition tree indents every nesting level, and
      // at 920 pixels a group three deep put its value field in a column two
      // words wide — so the editor's own shape was arguing with the thing
      // being edited.
      width="min(720px, 100vw)"
      rootClassName={`nx-fd-advdrawer ${URL_OVERLAY}`}
      title={
        <div className="nx-fd-dhead">
          <span className="nx-fd-dtitle"><ApartmentOutlined /> Advanced conditions</span>
          {props.datasetLabel && (
            <span className="nx-fd-dsub">
              {props.datasetLabel}
              {props.recordCount !== undefined ? ` · ${props.recordCount.toLocaleString()} records` : ""}
            </span>
          )}
        </div>
      }
      onClose={props.onClose}
      // Discarding the component discards the draft, which is the whole
      // contract: what was not searched for was not asked.
      destroyOnHidden
    >
      {props.open && <AdvancedSearchBody key={props.request.resource_type} {...props} />}
    </Drawer>
  );
}

function AdvancedSearchBody({ fields, request, onClose, onSearch, onSave, recordCount, datasetLabel, onOpenSaved, resources, onChooseResource }: AdvancedSearchDrawerProps) {
  const [draft, setDraft] = useState<QueryNode | null>(request.condition_tree ?? null);

  // Same endpoint, same shape, first page only: the preview is the search.
  const previewRequest = useMemo<ExplorerRequest>(
    () => ({ ...request, condition_tree: draft, page: 1 }),
    [request, draft],
  );
  const debounced = useDebouncedValue(previewRequest, 280);
  const preview = useQuery({
    queryKey: ["explorer-preview", debounced],
    queryFn: ({ signal }) => explorerApi.query(debounced, signal),
    placeholderData: (previous) => previous,
  });

  /**
   * Whether the lesson is open, remembered for this reader (§72).
   *
   * On the first visit it is: somebody who has never met a condition builder
   * needs the two nouns explained before the controls make sense. After they
   * have closed it, it stays closed — a tutorial that reappears every time is
   * an alert.
   */
  const [helpOpen, setHelpOpen] = useSticky<boolean>("explore.advanced.help", false);

  const rules = countRules(draft);
  const settling = preview.isFetching || previewRequest !== debounced;
  const applied = JSON.stringify(request.condition_tree ?? null) === JSON.stringify(draft ?? null);

  const apply = () => {
    onSearch(rules ? draft : null);
    onClose();
  };

  // ⌘/Ctrl + Enter applies from anywhere in the drawer, as the old builder's
  // Search button could be reached without the mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        apply();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="nu-advanced-search nx-fd-advbody">
      <div className="nx-fd-dfind">
        <span>Find</span>
        {resources && resources.length > 0 && onChooseResource ? (
          <Select
            className="nx-fd-dfind-select"
            aria-label="Dataset"
            data-testid="dataset-select"
            value={request.resource_type}
            popupMatchSelectWidth={false}
            onChange={onChooseResource}
            options={resources.map((item) => ({
              value: item.key,
              label: (
                <span className="nx-fd-typeopt">
                  <span>{item.label}</span>
                  <span className="nx-fd-muted">{item.record_count.toLocaleString()}</span>
                </span>
              ),
            }))}
            labelRender={() => resources.find((item) => item.key === request.resource_type)?.label ?? request.resource_type}
          />
        ) : (
          <b>{datasetLabel ?? request.resource_type}</b>
        )}
        <span>where</span>
        {onOpenSaved && (
          <button type="button" className="nx-fd-link nx-fd-push" onClick={onOpenSaved}>
            Load a saved search
          </button>
        )}
      </div>
      {/* What a rule and a group *are*, folded until asked for — and it stays
          as this reader left it (§72). */}
      <Collapse
        size="small"
        className="nu-advanced-help nx-fd-dhow"
        activeKey={helpOpen ? ["how"] : []}
        onChange={(keys) => setHelpOpen(keys.length > 0)}
        items={[{ key: "how", label: "How this works", children: (
              <div className="nu-advanced-lesson" data-testid="advanced-help">
                <div>
                  <Text strong>A rule</Text>
                  <Paragraph type="secondary">
                    One comparison: a field, how to compare it, and what to compare it with —{" "}
                    <Text code>Status is Open</Text>. Rules you have not finished are ignored
                    while you work, so a half-typed one never changes the count.
                  </Paragraph>
                </div>
                <div>
                  <Text strong>A group</Text>
                  <Paragraph type="secondary">
                    A bracket around rules. Everything inside is answered together and then
                    compared with what is outside — which is how{" "}
                    <Text code>A and (B or C)</Text> is said, and it means something different
                    from <Text code>(A and B) or C</Text>.
                  </Paragraph>
                </div>
                <div>
                  <Text strong>And · Or · Not</Text>
                  <Paragraph type="secondary">
                    <Text strong>And</Text> narrows — every rule has to hold.{" "}
                    <Text strong>Or</Text> widens — any one will do. <Text strong>Not</Text>{" "}
                    inverts the whole group, so “not (open and urgent)” keeps everything that is
                    not both.
                  </Paragraph>
                </div>
                <div>
                  <Text strong>Nothing runs until you say so</Text>
                  <Paragraph type="secondary">
                    The number at the bottom previews this draft against the real data. The page
                    behind keeps showing the last question you ran, and closing this without
                    pressing <Text strong>Search</Text> leaves it exactly as it was.
                  </Paragraph>
                </div>
              </div>
        ) }]}
      />
      {/* What a rule and a group *are*, before anybody is asked to build one.
          The editor is two nouns and three connectives, and none of them is
          named anywhere on screen — so the panel that used to sit here said
          "build groups with AND, OR and NOT" to a reader who had not been told
          what a group was. Collapsible, and it stays as this reader left it
          (§72): it is a tutorial, and a tutorial that will not go away is an
          alert. */}

      {/* AI (§42): a description becomes this draft, for review before Apply. */}
      <DescribeFilters resourceType={request.resource_type} currentTree={draft} onLoad={setDraft} />

      <ConditionBuilder fields={fields} value={draft} onChange={setDraft} />

      <Collapse
        ghost
        size="small"
        className="nx-fd-dcode"
        items={[
          {
            key: "sql",
            forceRender: true,
            label: (
              <span className="nx-fd-row">
                <span>Query preview</span>
                <Tooltip title="Rendered by the server from the same tree it compiles into SQL — so what is written here is what will run">
                  <QuestionCircleOutlined className="nu-advanced-hint" />
                </Tooltip>
              </span>
            ),
            children: (
              <pre data-testid="query-inspector">
                {preview.data?.condition_text?.trim() || "All records"}
              </pre>
            ),
          },
        ]}
      />


      {preview.isError && (
        <Alert
          type="error"
          showIcon
          message="This condition could not be previewed"
          description={preview.error instanceof Error ? preview.error.message : "Unknown error"}
        />
      )}

      <div className="nu-advanced-actions">
        <div className="nx-fd-dmatch">
          <span className="nx-fd-dmatch-label">Records matching</span>
          <b data-testid="preview-count" aria-live="polite">
            {(preview.data?.total ?? 0).toLocaleString()}
            <span className="nx-fd-sr"> of {(recordCount ?? 0).toLocaleString()} {(datasetLabel ?? "records").toLowerCase()} match</span>
          </b>
          <span className="nx-fd-muted nx-fd-small">
            {settling
              ? "Previewing…"
              : rules === 0
                ? `Every ${(datasetLabel ?? "record").toLowerCase().replace(/s$/, "")} (no conditions yet)`
                : `of ${(recordCount ?? 0).toLocaleString()} · ${rules} ${rules === 1 ? "condition" : "conditions"}`}
          </span>
        </div>
        <Space wrap className="nx-fd-dbtns">
          <Tooltip title="Empty the tree and start again. Nothing on the page behind changes.">
            <Button disabled={rules === 0} onClick={() => setDraft(emptyTree())}>
              Clear all
            </Button>
          </Tooltip>
          <Tooltip title="Save this condition under a name, without running it first">
            <Button onClick={() => onSave(draft)}>Save as…</Button>
          </Tooltip>
          <Button onClick={onClose}>Cancel</Button>
          <Tooltip title="Run this condition (⌘/Ctrl + Enter). It becomes the question the page is asking.">
            <Button type="primary" icon={<SearchOutlined />} data-testid="run-advanced-search" onClick={apply}>
              {applied ? "Search" : `Search · ${(preview.data?.total ?? 0).toLocaleString()} matches`}
            </Button>
          </Tooltip>
        </Space>
      </div>
    </div>
  );
}
