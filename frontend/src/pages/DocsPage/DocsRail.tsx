import { Button, Input, Select, Skeleton, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { PageTree } from "@/components/docs/PageTree";
import "@/styles/collab.css";
import "@/styles/docs.css";

import type { DocsPageModel } from "./useDocsPage";

const { Text } = Typography;

/** The space picker, search, the page tree and New page. */
export function DocsRail({ m }: { m: DocsPageModel }) {
  const { pageId, navigate, setCreating, query, spaces, spaceId, tree, setParam, move, canEdit, spaceList } = m;
  return (
    <div className="nx-dc-rail">
      <Select
        className="nx-dc-space-select"
        aria-label="Space"
        value={spaceId}
        loading={spaces.isLoading}
        options={spaceList.map((item) => ({ value: item.id, label: `${item.icon ?? ""} ${item.name}`.trim() }))}
        onChange={(id: string) => {
          if (pageId) navigate(`/docs?space=${id}`);
          else setParam("space", id);
        }}
        data-testid="docs-space"
      />
      <Input.Search
        allowClear
        value={query}
        placeholder="Search docs"
        aria-label="Search docs"
        onChange={(event) => {
          if (pageId && event.target.value) navigate(`/docs?q=${encodeURIComponent(event.target.value)}`);
          else setParam("q", event.target.value || null);
        }}
        data-testid="docs-search"
      />
      <div className="nx-dc-tree-wrap" data-testid="docs-tree">
        {tree.isLoading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : (tree.data?.items ?? []).length === 0 ? (
          <Text type="secondary">No pages in this space yet.</Text>
        ) : (
          <PageTree
            items={tree.data!.items}
            selected={pageId}
            canEdit={canEdit}
            onOpen={(id) => navigate(`/docs/${id}`)}
            onMove={(request) => move.mutate(request)}
          />
        )}
      </div>
      {canEdit && (
        <Button block icon={<PlusOutlined />} onClick={() => setCreating(true)} data-testid="new-page-rail">
          New page
        </Button>
      )}
    </div>
  );
}
