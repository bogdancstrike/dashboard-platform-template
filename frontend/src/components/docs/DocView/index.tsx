/**
 * One wiki page, read or edited (§48–49).
 *
 * * **Saving is continuous, history is not.** The editor saves a second after
 *   the last keystroke; the server folds a burst of saves by one person into
 *   one revision, so the history reads as edits rather than keystrokes.
 * * **Somebody else's save is not overwritten.** Every save names the version
 *   it was made from; a 409 says another person saved first, and the page
 *   offers to load theirs rather than silently winning.
 * * **Ticking a box is not "editing".** A checklist item or an action item can
 *   be ticked while reading, and is saved at once.
 */

import { Alert, Button, Card, Input, Space, Tag, Typography } from "antd";
import { RobotOutlined } from "@ant-design/icons";

import { ApiError } from "@/api/client";
import { PersonAvatar } from "@/components/PersonAvatar";
import { MarkdownLite } from "@/components/collab/MarkdownLite";
import { initials } from "@/components/collab/MessageItem";
import { absoluteTime, relativeTime } from "@/lib/time";

import { newDocBlock } from "../blocks";
import { HistoryDrawer } from "../HistoryDrawer";
import { RecordPicker } from "../RecordPicker";

const { Text } = Typography;

import { DocBody } from "./DocBody";
import { DocSide } from "./DocSide";
import { DocToolbar } from "./DocToolbar";
import { useDocView } from "./useDocView";

export function DocView({ pageId, onDeleted }: { pageId: string; onDeleted: (spaceId: string) => void }) {
  const m = useDocView(pageId, onDeleted);
  const { navigate, history, editing, draft, setDraft, setDirty, conflict, setConflict, linking, setLinking, summary, setSummary, page, data, accept, change, setBlocks, link } = m;

  if (page.isError || (!page.isLoading && !data)) {
    return (
      <Alert
        type="warning"
        showIcon
        message={page.error instanceof ApiError ? page.error.message : "That page could not be loaded."}
        action={<Button onClick={() => navigate("/docs")}>All docs</Button>}
      />
    );
  }
  if (!draft || !data) return <Card loading className="nx-dc-card" />;

  return (
    <div className="nx-dc-view" data-testid="doc-page">
      <div className="nx-dc-main">
        <Card className="nx-dc-card">
          <DocToolbar m={m} />
          <div className="nx-dc-titlebar">
            {editing ? (
              <Space.Compact className="nx-dc-title-edit">
                <Input
                  aria-label="Page icon"
                  className="nx-dc-icon-input"
                  maxLength={4}
                  value={draft.icon ?? ""}
                  placeholder="📄"
                  onChange={(event) => change({ ...draft, icon: event.target.value || null })}
                />
                <Input
                  aria-label="Title"
                  className="nx-dc-title-input"
                  value={draft.title}
                  onChange={(event) => change({ ...draft, title: event.target.value })}
                  data-testid="doc-title"
                />
              </Space.Compact>
            ) : (
              <h1 className="nx-dc-title">
                {draft.icon && <span aria-hidden>{draft.icon}</span>} {draft.title}
              </h1>
            )}
          </div>
          <div className="nx-dc-byline">
            {data.updated_by && <PersonAvatar size={20} src={data.updated_by.avatar_url} initials={initials(data.updated_by.name)} />}
            <Text type="secondary" title={absoluteTime(data.updated_at)}>
              Edited by {data.updated_by?.name ?? "somebody"} · {relativeTime(data.updated_at)}
            </Text>
            {data.event && <Tag bordered={false} color="green">meeting notes</Tag>}
          </div>

          {conflict && (
            <Alert
              type="warning"
              showIcon
              className="nu-block"
              message="Somebody else saved this page while you were editing it."
              description="Load their version to keep working — your last change is not saved."
              action={
                <Button
                  onClick={() => {
                    setConflict(false);
                    setDirty(false);
                    void page.refetch();
                  }}
                >
                  Load the latest
                </Button>
              }
            />
          )}

          {summary && (
            <div className="nx-dc-summary" data-testid="doc-summary">
              <div className="nx-dc-summary-head">
                <RobotOutlined /> <strong>Summary</strong>
                <Space size={4}>
                  {data.can_edit && (
                    <Button
                      onClick={() => {
                        setBlocks([{ ...newDocBlock("callout"), tone: "info", text: `**Summary** — ${summary}` }, ...draft.blocks]);
                        setSummary(null);
                      }}
                    >
                      Add to page
                    </Button>
                  )}
                  <Button type="text" onClick={() => setSummary(null)}>
                    Dismiss
                  </Button>
                </Space>
              </div>
              <MarkdownLite text={summary} />
            </div>
          )}

          <DocBody m={m} />
        </Card>
      </div>

      <DocSide m={m} />

      <RecordPicker
        open={linking}
        title="Link a record"
        onClose={() => setLinking(false)}
        onPick={(record) => link.mutate(record)}
      />
      <HistoryDrawer
        page={data}
        open={history.value !== null}
        onClose={history.close}
        onRestored={(restored) => {
          setDirty(false);
          accept(restored);
          setDraft({ title: restored.title, icon: restored.icon, blocks: restored.blocks });
          history.close();
        }}
      />
    </div>
  );
}
