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
import { Alert, Button, Card, Collapse, Drawer, Space, Statistic, Tooltip, Typography } from "antd";
import {
  ApartmentOutlined,
  ClearOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@ant-design/icons";

import { explorerApi, type ExplorerField, type ExplorerRequest } from "@/api/explorer";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSticky } from "@/hooks/useSticky";

import { AdvancedQueryBuilder } from "./AdvancedQueryBuilder";
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
}

export function AdvancedSearchDrawer(props: AdvancedSearchDrawerProps) {
  return (
    <Drawer
      open={props.open}
      // Wider than it was. A condition tree indents every nesting level, and
      // at 920 pixels a group three deep put its value field in a column two
      // words wide — so the editor's own shape was arguing with the thing
      // being edited.
      width="min(1180px, 96vw)"
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

  /**
   * Whether the lesson is open, remembered for this reader (§72).
   *
   * On the first visit it is: somebody who has never met a condition builder
   * needs the two nouns explained before the controls make sense. After they
   * have closed it, it stays closed — a tutorial that reappears every time is
   * an alert.
   */
  const [helpOpen, setHelpOpen] = useSticky<boolean>("explore.advanced.help", true);

  const rules = countRules(draft);
  const settling = preview.isFetching || previewRequest !== debounced;
  const applied = JSON.stringify(request.condition_tree ?? null) === JSON.stringify(draft ?? null);

  return (
    <div className="nu-advanced-search">
      {/* What a rule and a group *are*, before anybody is asked to build one.
          The editor is two nouns and three connectives, and none of them is
          named anywhere on screen — so the panel that used to sit here said
          "build groups with AND, OR and NOT" to a reader who had not been told
          what a group was. Collapsible, and it stays as this reader left it
          (§72): it is a tutorial, and a tutorial that will not go away is an
          alert. */}
      <Collapse
        ghost
        size="small"
        className="nu-advanced-help"
        activeKey={helpOpen ? ["how"] : []}
        onChange={(keys) => setHelpOpen(keys.length > 0)}
        items={[
          {
            key: "how",
            label: (
              <Space size={6}>
                <QuestionCircleOutlined />
                <Text strong>How this works</Text>
              </Space>
            ),
            children: (
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
            ),
          },
        ]}
      />

      <AdvancedQueryBuilder fields={fields} value={draft} onChange={setDraft} />

      <Card
        size="small"
        title={
          <Space size={6}>
            <span>What this asks</span>
            <Tooltip title="Rendered by the server from the same tree it compiles into SQL — so what is written here is what will run">
              <QuestionCircleOutlined className="nu-advanced-hint" />
            </Tooltip>
          </Space>
        }
        className="nu-query-inspector"
      >
        <pre data-testid="query-inspector">
          {preview.data?.condition_text?.trim() || "All records"}
        </pre>
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
          <Tooltip title="Empty the tree and start again. Nothing on the page behind changes.">
            <Button
              icon={<ClearOutlined />}
              disabled={rules === 0}
              onClick={() => setDraft(emptyTree())}
            >
              Clear
            </Button>
          </Tooltip>
          <Tooltip title="Save this condition under a name, without running it first">
            <Button icon={<SaveOutlined />} onClick={() => onSave(draft)}>
              Save as…
            </Button>
          </Tooltip>
          <Tooltip title="Run this condition. It becomes the question the page is asking.">
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
          </Tooltip>
        </Space>
      </div>
    </div>
  );
}
