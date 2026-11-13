import { Button, Popconfirm, Segmented, Skeleton, Tooltip, Typography } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";

import { EmptyState } from "@/components/EmptyState";
import { AskPanel } from "@/components/knowledge/AskPanel";
import { DocumentsPanel } from "@/components/knowledge/DocumentsPanel";
import { KnIcon } from "@/components/icons/KnIcon";

import { SCOPE_LABEL } from "../model";
const { Text } = Typography;

import type { DocumentsPageData } from "../useDocumentsPage";

/** The chosen collection: its header, its tabs, its documents and its questions. */
export function CollectionDetail({ page }: { page: DocumentsPageData }) {
  const {
    setModal,
    threadId,
    tab,
    list,
    activeId,
    collection,
    remove,
    setTab,
    setThread,
    openCitation,
    openDocument,
    canCreate,
  } = page;
  return (
    <section className="nx-kn-main nx-glass" data-testid="collection-detail">
      {!activeId && !list.isLoading && (
        <EmptyState
          title="Pick a collection, or make one"
          hint="A collection is a set of files with one audience. Questions are answered only from its files."
          action={
            canCreate && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal("create")}>
                New collection
              </Button>
            )
          }
        />
      )}
      {activeId && !collection && <Skeleton active paragraph={{ rows: 8 }} />}
      {collection && (
        <>
          <header className="nx-kn-head">
            <span className="nx-kn-head-mark" style={{ background: collection.color }}>
              <KnIcon name="documents" size={18} />
            </span>
            <div className="nx-kn-head-text">
              <h2 className="nx-kn-title" data-testid="collection-title">
                {collection.name}
              </h2>
              <Text type="secondary" className="nx-kn-sub">
                {[
                  SCOPE_LABEL[collection.scope],
                  collection.owner.name ? `owned by ${collection.owner.name}` : null,
                  `${collection.counts.ready} of ${collection.counts.documents} documents ready`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              {collection.description && (
                <Text className="nx-kn-desc">{collection.description}</Text>
              )}
            </div>
            {collection.can_edit && (
              <div className="nx-kn-head-actions">
                <Tooltip title="Edit name and audience">
                  <Button
                    shape="circle"
                    icon={<EditOutlined />}
                    aria-label="Edit collection"
                    onClick={() => setModal("edit")}
                    data-testid="collection-edit"
                  />
                </Tooltip>
                <Popconfirm
                  title="Remove this collection?"
                  description="Its conversations go with it; the files stay in Files."
                  okText="Remove"
                  onConfirm={() => remove.mutate(collection.id)}
                >
                  <Button
                    shape="circle"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="Remove collection"
                  />
                </Popconfirm>
              </div>
            )}
          </header>

          <Segmented
            className="nx-kn-tabs"
            value={tab}
            onChange={(value) => setTab(value as "ask" | "documents")}
            options={[
              { value: "ask", label: "Ask" },
              { value: "documents", label: `Documents · ${collection.counts.documents}` },
            ]}
            data-testid="collection-tabs"
          />

          {tab === "ask" ? (
            <AskPanel
              collection={collection}
              threadId={threadId}
              onThread={setThread}
              onCite={openCitation}
            />
          ) : (
            <DocumentsPanel
              collection={collection}
              supported={list.data?.supported_extensions ?? []}
              maxBytes={list.data?.max_document_bytes}
              onPreview={openDocument}
            />
          )}
        </>
      )}
    </section>
  );
}
