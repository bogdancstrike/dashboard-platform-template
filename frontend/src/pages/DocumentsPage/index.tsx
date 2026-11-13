import { Button } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import { filesApi } from "@/api/files";
import { PageHeader } from "@/components/PageHeader";
import { FilePreview } from "@/components/files/FilePreview";
import { CollectionModal } from "@/components/knowledge/CollectionModal";

import { CollectionDetail } from "./parts/CollectionDetail";
import { CollectionPicker } from "./parts/CollectionPicker";
import { useDocumentsPage } from "./useDocumentsPage";

export default function DocumentsPage() {
  const page = useDocumentsPage();
  const {
    phone,
    modal,
    setModal,
    passage,
    docPreview,
    collection,
    save,
    cited,
    previewFile,
    canCreate,
    stats,
  } = page;

  return (
    <div className="nu-page nx-kn" data-testid="documents-page">
      <PageHeader
        title={
          <>
            Ask your <em>documents</em>
          </>
        }
        subtitle={
          stats
            ? `${stats.collections} collection${stats.collections === 1 ? "" : "s"} · ${stats.documents} documents · ${stats.pages} pages read${stats.pending ? ` · ${stats.pending} being read` : ""}`
            : "Answers from your files, with every claim cited to its page"
        }
        actions={
          canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setModal("create")}
              data-testid="collection-new"
            >
              New collection
            </Button>
          )
        }
      />

      <div className={`nx-kn-layout${phone ? " is-phone" : ""}`}>
        <CollectionPicker page={page} />

        <CollectionDetail page={page} />
      </div>

      <CollectionModal
        open={modal !== null}
        initial={modal === "edit" ? collection : null}
        saving={save.isPending}
        onCancel={() => setModal(null)}
        onSubmit={(input) => save.mutate(input)}
      />

      <FilePreview
        open={Boolean((passage.value || docPreview.value) && previewFile.data)}
        file={previewFile.data ?? null}
        onClose={passage.value ? passage.close : docPreview.close}
        onDownload={(file) =>
          void filesApi
            .downloadUrl(file.id)
            .then(({ download }) => window.open(download.url, "_blank"))
        }
        focus={
          passage.value && cited
            ? { page: cited.page, quote: cited.quote, boxes: cited.boxes }
            : null
        }
      />
    </div>
  );
}
