import { Button, Dropdown, Space, Typography } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";

import type { BlockKind } from "@/api/reportDocuments";
import { BLOCK_SPECS, BLOCK_ORDER } from "@/components/documents/blocks";

import { describe } from "../model";
const { Text } = Typography;

import type { ReadyBuilder } from "../useReportBuilder";

/** What the document is made of, in order, with the controls to add and move blocks. */
export function BlockOutline({ view }: { view: ReadyBuilder }) {
  const {
    modal,
    selected,
    setSelected,
    savedReports,
    canEdit,
    blocks,
    addBlock,
    moveBlock,
    dropBlock,
  } = view;
  return (
    <>
      {/* What the document is made of, in order. Deliberately a list rather
          than the page itself: a twelve-block document is a page somebody
          scrolls, and reordering by dragging paragraphs around a preview is
          a gesture nobody can aim. */}
      <aside className="nu-doc-outline" aria-label="Blocks">
        <div className="nu-doc-outline-head">
          <Text strong>Blocks</Text>
          {canEdit && (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: BLOCK_ORDER.map((kind) => ({
                  key: kind,
                  icon: BLOCK_SPECS[kind].icon,
                  label: (
                    <span className="nu-doc-additem">
                      <span>{BLOCK_SPECS[kind].label}</span>
                      <span>{BLOCK_SPECS[kind].hint}</span>
                    </span>
                  ),
                })),
                onClick: ({ key }) => addBlock(key as BlockKind),
              }}
            >
              <Button type="primary" icon={<PlusOutlined />} data-testid="add-block">
                Add
              </Button>
            </Dropdown>
          )}
        </div>

        <ol className="nu-doc-outline-list">
          {blocks.map((block, index) => (
            <li key={block.id}>
              <div
                className={`nu-doc-outline-row${selected === block.id ? " is-chosen" : ""}`}
                data-testid={`outline-${block.id}`}
              >
                <button
                  type="button"
                  className="nu-doc-outline-face"
                  onClick={() => setSelected(block.id)}
                >
                  <span className="nu-doc-outline-icon" aria-hidden>
                    {BLOCK_SPECS[block.kind].icon}
                  </span>
                  <span className="nu-doc-outline-text">
                    <span className="nu-doc-outline-label">
                      {describe(block, savedReports.data?.items ?? [])}
                    </span>
                    <span className="nu-doc-outline-kind">{BLOCK_SPECS[block.kind].label}</span>
                  </span>
                </button>
                {canEdit && (
                  <Space size={0}>
                    <Button
                      type="text"
                      aria-label={`Move ${BLOCK_SPECS[block.kind].label} up`}
                      disabled={index === 0}
                      icon={<ArrowUpOutlined />}
                      onClick={() => moveBlock(block.id, -1)}
                    />
                    <Button
                      type="text"
                      aria-label={`Move ${BLOCK_SPECS[block.kind].label} down`}
                      disabled={index === blocks.length - 1}
                      icon={<ArrowDownOutlined />}
                      onClick={() => moveBlock(block.id, 1)}
                    />
                    <Button
                      type="text"
                      danger
                      aria-label={`Remove ${BLOCK_SPECS[block.kind].label}`}
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        modal.confirm({
                          title: `Remove this ${BLOCK_SPECS[block.kind].label.toLowerCase()}?`,
                          content: "It comes off the document. Nothing it pointed at is affected.",
                          okText: "Remove",
                          okButtonProps: { danger: true },
                          onOk: () => dropBlock(block.id),
                        })
                      }
                    />
                  </Space>
                )}
              </div>
            </li>
          ))}
          {blocks.length === 0 && (
            <Text type="secondary" className="nu-doc-outline-empty">
              Nothing yet. Add a heading to begin.
            </Text>
          )}
        </ol>
      </aside>
    </>
  );
}
