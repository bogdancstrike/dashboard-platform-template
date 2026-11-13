import { Button, Space, Tag, Tooltip, Typography } from "antd";
import { CopyOutlined, ShareAltOutlined } from "@ant-design/icons";

import type { ReportDocument } from "@/api/reportDocuments";
import { BLOCK_SPECS } from "@/components/documents/blocks";
import { relativeTime } from "@/lib/time";

const { Paragraph, Text } = Typography;

/** One document in the gallery. */
export function DocumentCard({
  document,
  canCopy,
  onOpen,
  onCopy,
}: {
  document: ReportDocument;
  canCopy: boolean;
  onOpen: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="nu-board-card" onClick={onOpen} data-testid={`document-card-${document.id}`}>
      <div className="nu-board-head">
        <Space size={6} className="nu-board-title">
          <button
            type="button"
            className="nu-board-open"
            // The card around it opens too; letting the click reach it pushed
            // the same address twice, so Back stayed on the document (audit A).
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            <Text strong ellipsis>
              {document.name}
            </Text>
          </button>
        </Space>
        <Space size={0} onClick={(event) => event.stopPropagation()}>
          {!document.can_edit && canCopy && (
            <Tooltip title="Make a copy you can change">
              <Button
                type="text"
                aria-label={`Make a copy of ${document.name}`}
                icon={<CopyOutlined />}
                onClick={onCopy}
              />
            </Tooltip>
          )}
        </Space>
      </div>
      <Paragraph type="secondary" className="nu-board-desc" ellipsis={{ rows: 2 }}>
        {document.description ||
          `${document.block_count} ${document.block_count === 1 ? "block" : "blocks"} · ${document.page.size} ${document.page.orientation}`}
      </Paragraph>
      <div className="nu-board-kinds">
        {document.block_kinds.slice(0, 5).map((kind) => (
          <Tag key={kind} bordered={false}>
            {BLOCK_SPECS[kind].label}
          </Tag>
        ))}
        {document.block_kinds.length === 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Nothing on it yet
          </Text>
        )}
      </div>
      <div className="nu-board-foot">
        <Text type="secondary">{relativeTime(document.updated_at)}</Text>
        <Space size={6}>
          {document.render_count > 0 && (
            <Tag bordered={false}>
              exported {document.render_count === 1 ? "once" : `${document.render_count} times`}
            </Tag>
          )}
          {!document.can_edit && (
            <Tag bordered={false} icon={<ShareAltOutlined />}>
              {document.owner.name}
            </Tag>
          )}
        </Space>
      </div>
    </div>
  );
}
