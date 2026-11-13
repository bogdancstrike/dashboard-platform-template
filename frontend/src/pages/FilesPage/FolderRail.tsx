import { Card, Tree, Typography } from "antd";
import { readableSize } from "@/api/files";
import { CollapseAllToggle } from "@/components/CollapseAllToggle";
import { UNFILED } from "./transfers";

import type { FilesPageModel } from "./useFilesPage";

/** The folders as a tree, with what the store holds and the folder actions. */
export function FolderRail({ m }: { m: FilesPageModel }) {
  const { setFolderId, tree, open, nodes, parentKeys, expanded, setExpanded, stored } = m;
  const { Text } = Typography;
  return (
    <Card
      size="small"
      className="nu-pane nu-split-list"
      title="Folders"
      data-testid="folder-tree"
      extra={
        parentKeys.length > 0 ? (
          <CollapseAllToggle
            allCollapsed={(expanded ?? parentKeys).length === 0}
            onToggle={(collapse) => setExpanded(collapse ? [] : parentKeys)}
            label="folders"
          />
        ) : undefined
      }
    >
      <Tree
        blockNode
        expandedKeys={expanded ?? parentKeys}
        onExpand={(keys) => setExpanded(keys.map(String))}
        selectedKeys={[open]}
        treeData={nodes as never}
        onSelect={(keys) => setFolderId(String(keys[0] ?? UNFILED))}
      />

      {/* At the foot of the rail rather than in the page header: it is
          what the *whole* store holds, which is the one fact about this
          page that belongs nowhere in particular — and thirteen short
          folder names left the column two thirds empty. */}
      <div className="nu-rail-foot">
        <Text type="secondary">
          {stored.files.toLocaleString()} {stored.files === 1 ? "file" : "files"} ·{" "}
          {readableSize(stored.bytes)}
        </Text>
        <Text type="secondary">
          {tree.data?.store === "local" ? "served by the API" : "object storage"}
        </Text>
      </div>
    </Card>
  );
}
