import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Select, Space, Tag as AntTag, Tooltip, Typography } from "antd";
import { TagsOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import type { Tag } from "@/api/tags";
import { tagsApi } from "@/api/tags";

const { Text } = Typography;

/**
 * The tags on one record, and changing them (§37).
 *
 * Four decisions worth the reader's attention.
 *
 * **The whole set is sent, not one change at a time.** Two people editing the
 * same record's tags with add and remove calls interleave into a set neither of
 * them chose, and each sees their own change land and the other's vanish.
 *
 * **Only tags that exist may be chosen.** The picker offers the vocabulary and
 * refuses free text, because a typo typed into a shared vocabulary is a
 * permanent member of it — which is the thing having a vocabulary prevents.
 * Somebody who needs a new one goes to `/admin/tags`, and the picker says so.
 *
 * **A reader who may not edit sees the tags, not a disabled picker.** A row of
 * chips is the useful thing; a greyed-out select beside it is chrome that says
 * "you cannot" about something nobody asked to do.
 *
 * **Each tag links to the list filtered by it.** A label nobody can act on is
 * decoration; "show me everything else tagged urgent" is the question a tag
 * exists to answer (§44).
 */
export function TagPicker({
  resourceType,
  recordId,
  listPath,
}: {
  resourceType: string;
  recordId: string;
  /** Where the tag's own link goes — `/tasks`, `/orders`. */
  listPath: string;
}) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);

  const current = useQuery({
    queryKey: ["record-tags", resourceType, recordId],
    queryFn: ({ signal }) => tagsApi.onRecord(resourceType, recordId, signal),
  });

  const vocabulary = useQuery({
    queryKey: ["tag-vocabulary"],
    queryFn: ({ signal }) => tagsApi.vocabulary(signal),
    // Only once the reader has asked to edit: a picker nobody opened does not
    // need the whole vocabulary fetched behind it.
    enabled: editing,
    staleTime: 60_000,
  });

  // Reset to what the record actually carries whenever it changes or the
  // picker reopens, so a cancelled edit cannot be applied by accident later.
  useEffect(() => {
    setChosen((current.data?.items ?? []).map((tag) => tag.name));
  }, [current.data, editing]);

  const save = useMutation({
    mutationFn: (names: string[]) => tagsApi.apply(resourceType, recordId, names),
    onSuccess: (answer) => {
      queryClient.setQueryData(["record-tags", resourceType, recordId], answer);
      // The list's rows carry the tags too, from the derived column — so they
      // are stale until refetched.
      void queryClient.invalidateQueries({ queryKey: ["entity-rows"] });
      void queryClient.invalidateQueries({ queryKey: ["record", resourceType] });
      void queryClient.invalidateQueries({ queryKey: ["tag-vocabulary"] });
      setEditing(false);
      message.success("Tags saved");
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError ? error.message : "Those tags could not be saved.",
      ),
  });

  const tags = current.data?.items ?? [];
  const mayEdit = current.data?.can_apply ?? false;

  // Nothing until it knows, rather than "No tags" while the request is in
  // flight. The same lesson `/home`'s waiting strip learned: a page that
  // states an absence before it has looked is stating something false to the
  // one reader who glances and moves on.
  if (current.isLoading) {
    return <div className="nu-tags" data-testid="record-tags-loading" aria-busy="true" />;
  }

  if (!editing) {
    return (
      <div className="nu-tags" data-testid="record-tags">
        <TagsOutlined className="nu-tags-icon" aria-hidden />
        {tags.length === 0 ? (
          <Text type="secondary">No tags</Text>
        ) : (
          <Space size={[4, 4]} wrap>
            {tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} listPath={listPath} />
            ))}
          </Space>
        )}
        {/* A reader who may not edit sees the chips and nothing else: a
            disabled control beside them says "you cannot" about something
            nobody asked to do. */}
        {mayEdit && (
          <button
            type="button"
            className="nu-tags-edit"
            onClick={() => setEditing(true)}
            data-testid="record-tags-edit"
          >
            {tags.length === 0 ? "Add tags" : "Change"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="nu-tags nu-tags--editing" data-testid="record-tags-editor">
      <Select
        mode="multiple"
        className="nu-tags-select"
        value={chosen}
        onChange={setChosen}
        loading={vocabulary.isLoading}
        maxCount={current.data?.limit}
        placeholder="Choose from the vocabulary"
        aria-label="Tags"
        // Typing is how a vocabulary of twenty-odd is used: the list is sorted
        // by popularity, so a rarely-used tag is a scroll away, and AntD's
        // virtual list has not even rendered it. Without this the input is
        // read-only and the only way in is scrolling.
        showSearch
        // Free text is refused rather than created: a typo in a shared
        // vocabulary is a permanent member of it.
        options={(vocabulary.data?.items ?? []).map((tag) => ({
          value: tag.name,
          label: `${tag.name}${tag.usage_count ? ` · ${tag.usage_count}` : ""}`,
        }))}
        optionFilterProp="value"
        data-testid="record-tags-select"
      />
      <Space size={6}>
        <button
          type="button"
          className="nu-tags-edit"
          disabled={save.isPending}
          onClick={() => save.mutate(chosen)}
          data-testid="record-tags-save"
        >
          Save
        </button>
        <button
          type="button"
          className="nu-tags-edit"
          onClick={() => setEditing(false)}
          data-testid="record-tags-cancel"
        >
          Cancel
        </button>
      </Space>
      <Text type="secondary" className="nu-tags-hint">
        Only tags in the vocabulary. <Link to="/admin/tags">Manage them</Link>
      </Text>
    </div>
  );
}

/**
 * One tag, linking to everything else carrying it.
 *
 * `tags__contains` is the operator `core/query` gives an array column, and the
 * derived `tags` column is what the list filters on — so the link asks the same
 * question the chip is an answer to.
 */
export function TagChip({ tag, listPath }: { tag: Tag; listPath: string }) {
  return (
    <Tooltip title={tag.description || `${tag.category.toLowerCase()} · ${tag.usage_count} records`}>
      <Link to={`${listPath}?f.tags__contains=${encodeURIComponent(tag.name)}`}>
        <AntTag
          className="nu-tag-chip"
          // On the leading edge rather than as a fill, for the reason
          // `StatusTag` documents: AntD writes white on a custom colour without
          // measuring, and white on this palette's amber is 2.87:1 (§55).
          style={{ borderInlineStartColor: tag.color }}
        >
          {tag.name}
        </AntTag>
      </Link>
    </Tooltip>
  );
}
