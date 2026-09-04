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

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Drawer, Space, Statistic, Tooltip, Typography } from "antd";
import { ApartmentOutlined, ClearOutlined, SaveOutlined, SearchOutlined } from "@ant-design/icons";

import { explorerApi, type ExplorerField, type ExplorerRequest } from "@/api/explorer";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

import { AdvancedQueryBuilder } from "./AdvancedQueryBuilder";
import { countRules, emptyTree, type QueryNode } from "./queryTree";

const { Text } = Typography;

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
}

export function AdvancedSearchDrawer(props: AdvancedSearchDrawerProps) {
  return (
    <Drawer
      open={props.open}
      width="min(920px, 94vw)"
      title={<Space><ApartmentOutlined />Advanced conditions</Space>}
      onClose={props.onClose}
      // Discarding the component discards the draft, which is the whole
      // contract: what was not searched for was not asked.
      destroyOnHidden
    >
      {props.open && <AdvancedSearchBody {...props} />}
    </Drawer>
  );
}

function AdvancedSearchBody({ fields, request, onClose, onSearch, onSave }: AdvancedSearchDrawerProps) {
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

  const rules = countRules(draft);
  const settling = preview.isFetching || previewRequest !== debounced;
  const applied = JSON.stringify(request.condition_tree ?? null) === JSON.stringify(draft ?? null);

  return (
    <div className="nu-advanced-search">
      <Alert
        type="info"
        showIcon
        message="Build groups with AND, OR and NOT"
        description="Incomplete rules are ignored while you work. The count below previews the draft; press Search to run it."
      />

      <AdvancedQueryBuilder fields={fields} value={draft} onChange={setDraft} />

      <Card size="small" title="Query inspector" className="nu-query-inspector">
        <pre data-testid="query-inspector">
          {preview.data?.condition_text?.trim() || "All records"}
        </pre>
        <Text type="secondary">Rendered by the backend from the same tree it compiled into SQL.</Text>
      </Card>

      {preview.isError && (
        <Alert
          type="error"
          showIcon
          message="This condition could not be previewed"
          description={preview.error instanceof Error ? preview.error.message : "Unknown error"}
        />
      )}

      <div className="nu-advanced-actions">
        <Statistic
          className="nu-advanced-count"
          data-testid="preview-count"
          title={settling ? "Previewing…" : rules === 1 ? "1 rule matches" : `${rules} rules match`}
          value={preview.data?.total ?? 0}
          suffix="records"
          valueStyle={{ fontSize: 20 }}
        />
        <Space>
          <Button
            icon={<ClearOutlined />}
            disabled={rules === 0}
            onClick={() => setDraft(emptyTree())}
          >
            Clear
          </Button>
          <Tooltip title="Save this condition under a name, without running it first">
            <Button icon={<SaveOutlined />} onClick={() => onSave(draft)}>
              Save as…
            </Button>
          </Tooltip>
          <Button
            type="primary"
            icon={<SearchOutlined />}
            data-testid="run-advanced-search"
            onClick={() => {
              onSearch(rules ? draft : null);
              onClose();
            }}
          >
            {applied ? "Search" : `Search · ${(preview.data?.total ?? 0).toLocaleString()} matches`}
          </Button>
        </Space>
      </div>
    </div>
  );
}
