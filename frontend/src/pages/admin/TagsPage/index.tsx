/**
 * The tag vocabulary (§37).
 *
 * A tag is the only classification a *reader* gets to invent. Everything else
 * this platform uses to describe a record — status, priority, health — is a
 * closed vocabulary declared in code, because a filter menu built from free
 * text has four spellings of "urgent" in it. Tags are the deliberate
 * exception, and the price of the exception is that somebody has to curate
 * them. This is where.
 *
 * Four decisions worth the reader's attention.
 *
 * **The usage count is a link.** "urgent · 9" opens the nine records, through
 * the list's own `tags__contains` filter — a count nobody can open is a count
 * nobody can act on (§44), and a tag on nothing is the first thing to delete.
 *
 * **A system tag says so, and its name is not editable.** Automations, saved
 * searches and reports quote a tag by name; renaming one would silently change
 * what they match and deleting it would silently match nothing. Its colour and
 * description are free.
 *
 * **Deleting says how many records it will come off.** "Remove urgent" and
 * "remove urgent from nine records" are different decisions, and only one of
 * them can be made from the first sentence.
 *
 * **A reader without `tags.manage` gets the vocabulary and no controls**, with
 * the permission named — the page is still worth opening to find out what the
 * tags mean (§76).
 */

import { Alert, Button, Card, Segmented, Skeleton, Space, Tag as AntTag, Tooltip, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import type { Tag, TagVocabulary } from "@/api/tags";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ResponsiveTable } from "@/components/listing/ResponsiveTable";

import { TagForm } from "./TagForm";
import { tagCard, tagColumns } from "./tagColumns";
import { useTagsPage } from "./useTagsPage";
import { summarise } from "./vocabulary";

export { CATEGORIES, summarise } from "./vocabulary";

const { Text } = Typography;

export default function TagsPage() {
  const page = useTagsPage();
  const { vocabulary, editing, setEditing } = page;

  return (
    <div className="nx-ad nx-ad--tags">
      <PageHeader
        title="Tags"
        subtitle="The one classification a reader invents. Everything else is a declared vocabulary."
        tag={vocabulary ? <AntTag data-testid="tags-total">{summarise(vocabulary)}</AntTag> : undefined}
        actions={
          <Tooltip title={vocabulary?.can_manage ? "" : "Your role does not include tags.manage"}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!vocabulary?.can_manage}
              onClick={() => setEditing("new")}
              data-testid="tag-new"
            >
              New tag
            </Button>
          </Tooltip>
        }
      />

      {page.query.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : !vocabulary ? (
        <EmptyState title="The vocabulary could not be loaded" />
      ) : (
        <Vocabulary vocabulary={vocabulary} page={page} />
      )}

      <TagForm
        open={editing !== null}
        tag={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          page.refresh();
        }}
      />
    </div>
  );
}

function Vocabulary({ vocabulary, page }: { vocabulary: TagVocabulary; page: ReturnType<typeof useTagsPage> }) {
  return (
    <>
      {!vocabulary.can_manage && (
        <Alert
          type="info"
          showIcon
          className="nu-block"
          data-testid="tags-readonly"
          message="You can read the vocabulary but not change it"
          description="Curating tags needs tags.manage — a rename changes what every record carrying the tag says. Applying a tag to a record needs only records.update."
        />
      )}

      <Card size="small" className="nu-filter-bar nu-block">
        <Space size={10} wrap>
          <Text type="secondary">Category</Text>
          <Segmented
            value={page.category || "all"}
            onChange={(value) => page.chooseCategory(String(value))}
            options={[
              { value: "all", label: `All (${vocabulary.total})` },
              ...vocabulary.categories
                .filter((entry) => entry.count > 0)
                .map((entry) => ({ value: entry.value, label: `${entry.value} (${entry.count})` })),
            ]}
            data-testid="tags-categories"
          />
        </Space>
      </Card>

      <Card size="small" className="nu-block">
        <ResponsiveTable<Tag>
          card={tagCard}
          rowKey="id"
          size="small"
          columns={tagColumns({ canManage: vocabulary.can_manage, onEdit: page.setEditing, onRemove: page.confirmRemove })}
          dataSource={page.rows}
          pagination={false}
          locale={{
            emptyText: (
              <EmptyState
                title="No tags in this category"
                hint="A tag's category is what makes two people filing one reach for the same place."
              />
            ),
          }}
          data-testid="tags-table"
        />
      </Card>
    </>
  );
}
