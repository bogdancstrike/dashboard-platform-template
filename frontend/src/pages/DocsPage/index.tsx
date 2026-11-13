/**
 * `/docs` and `/docs/<page>` — the wiki (§48–49).
 *
 * The space and its tree on the left, the page (or, with no page, the
 * recently changed ones and every space) on the right. The page is the
 * address, pushed; the space being browsed and the search are filters,
 * replaced; history is `?history=1`, so back closes it first.
 *
 * On a phone the tree is a drawer behind a "Pages" button: a tree beside a
 * page in 390 pixels is two unreadable columns.
 */

import { Button, Card, Drawer, Skeleton, Space, Typography } from "antd";
import { MenuOutlined, PlusOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/PageHeader";
import { HighlightedText } from "@/components/HighlightedText";
import { DocView } from "@/components/docs/DocView";
import { NewPageModal } from "@/components/docs/NewPageModal";
import { relativeTime } from "@/lib/time";
import "@/styles/collab.css";
import "@/styles/docs.css";
import { EmptyState } from "@/components/EmptyState";
import { queryKeys } from "@/lib/queryKeys";

import { DocsHome } from "./DocsHome";
import { NewSpaceModal } from "./NewSpaceModal";

const { Text } = Typography;

import { DocsRail } from "./DocsRail";
import { useDocsPage } from "./useDocsPage";

export default function DocsPage() {
  const m = useDocsPage();
  const { pageId, navigate, queryClient, phone, creating, setCreating, spacing, setSpacing, treeOpen, setTreeOpen, term, current, spaceId, tree, recent, results, canEdit, opened, spaceList, space } = m;

  const rail = <DocsRail m={m} />;

  return (
    <div className="nx-dc-page">
      <PageHeader
        title={
          <>
            Team <em>docs</em>
          </>
        }
        subtitle="Runbooks, specs, meeting notes and decisions — linked to the records they are about."
        actions={
          <Space wrap>
            {phone && (
              <Button icon={<MenuOutlined />} onClick={() => setTreeOpen(true)} data-testid="docs-pages">
                Pages
              </Button>
            )}
            {canEdit && !phone && (
              <Button onClick={() => setSpacing(true)} data-testid="new-space">
                New space
              </Button>
            )}
            {canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)} data-testid="new-page">
                New page
              </Button>
            )}
          </Space>
        }
      />

      <div className={`nx-dc-layout${phone ? " is-phone" : ""}`}>
        {!phone && <Card className="nx-dc-card nx-dc-rail-card">{rail}</Card>}
        <div className="nx-dc-content">
          {pageId ? (
            <DocView
              pageId={pageId}
              onDeleted={(id) => {
                void queryClient.invalidateQueries({ queryKey: queryKeys.docTree(id) });
                navigate(`/docs?space=${id}`, { replace: true });
              }}
            />
          ) : term.length >= 2 ? (
            <Card className="nx-dc-card" title={`Pages matching “${term}”`} data-testid="docs-results">
              {results.isLoading ? (
                <Skeleton active />
              ) : (results.data?.items ?? []).length === 0 ? (
                <EmptyState title="No page says that" />
              ) : (
                <ul className="nx-dc-results">
                  {results.data!.items.map((item) => (
                    <li key={item.id}>
                      <Link to={`/docs/${item.id}`}>
                        <span aria-hidden>{item.icon ?? "📄"}</span> <HighlightedText text={item.title} term={term} />
                      </Link>
                      <Text type="secondary" className="nx-dc-result-where">
                        {item.space} · {relativeTime(item.updated_at)}
                      </Text>
                      {item.snippet && (
                        <p className="nx-dc-snippet">
                          <HighlightedText text={item.snippet} term={term} />
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : (
            <DocsHome spaces={spaceList} recent={recent.data?.items} loading={recent.isLoading} current={space} />
          )}
        </div>
      </div>

      {phone && (
        <Drawer open={treeOpen} onClose={() => setTreeOpen(false)} placement="left" width="86%" title="Pages">
          {rail}
        </Drawer>
      )}

      <NewPageModal
        open={creating}
        spaces={spaceList}
        spaceId={spaceId}
        parentId={pageId && current.data?.space.id === spaceId ? pageId : null}
        pages={tree.data?.items ?? []}
        onClose={() => setCreating(false)}
        onCreated={opened}
      />
      <NewSpaceModal
        open={spacing}
        onClose={() => setSpacing(false)}
        onCreated={(created) => {
          setSpacing(false);
          void queryClient.invalidateQueries({ queryKey: queryKeys.docSpaces() });
          navigate(`/docs?space=${created.id}`);
        }}
      />
    </div>
  );
}
