/**
 * Naming, describing, sharing and handing over a saved search (§5).
 *
 * One form for creating and for editing, because they ask the same questions
 * and a create dialog that omits sharing teaches people that sharing lives
 * somewhere else.
 *
 * The sharing model it enforces on screen is the one the API enforces:
 * **private** by default, **shared** with people named individually, or
 * **public** to everyone signed in — and only the owner may change any of it.
 * Someone without `searches.share` sees why the choice is unavailable rather
 * than a 403 after typing a name.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Form,
  Input,
  Modal,
  Segmented,
  Typography,
} from "antd";

import { explorerApi, type SavedSearch, type SaveSearchInput } from "@/api/explorer";
import type { Person } from "@/api/directory";
import { useAuth } from "@/auth/AuthProvider";
import { PeoplePicker } from "@/components/PeoplePicker";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { queryKeys } from "@/lib/queryKeys";

import { initials, SCOPES, type Scope } from "./scopes";
import { TransferOwnership } from "./TransferOwnership";

const { Text } = Typography;

export type { Scope } from "./scopes";

interface FormValues {
  name: string;
  description: string;
  scope: Scope;
}

export interface SavedSearchFormProps {
  open: boolean;
  /** The question to store: conditions, filters, sort, columns, page size, mode. */
  value: Omit<SaveSearchInput, "name">;
  /** Editing an existing search rather than creating one. */
  search?: SavedSearch;
  onClose: () => void;
  onSaved: (search: SavedSearch) => void;
  /** Called after ownership changes, since the caller loses edit rights. */
  onTransferred?: (search: SavedSearch) => void;
}

export function SavedSearchForm({
  open,
  value,
  search,
  onClose,
  onSaved,
  onTransferred,
}: SavedSearchFormProps) {
  const [form] = Form.useForm<FormValues>();
  const { touch, settled, requestClose } = useDiscardGuard({
    close: onClose,
    what: "saved search",
  });
  const { message } = App.useApp();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const mayShare = can("searches.share");

  const [scope, setScope] = useState<Scope>(search?.scope ?? "PRIVATE");
  const [members, setMembers] = useState<string[]>([]);
  const [heir, setHeir] = useState<string[]>([]);
  /** Names for ids the search already carries, so they render before any search. */
  const [known, setKnown] = useState<Person[]>([]);

  const editing = Boolean(search);
  const initial = useMemo<FormValues>(
    () => ({
      name: search?.name ?? "",
      description: search?.description ?? "",
      scope: search?.scope ?? "PRIVATE",
    }),
    [search],
  );

  // Re-seeded each time it opens: a dialog that reopens holding the last
  // person's edits is a dialog that saves something nobody asked for.
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(initial);
    setScope(initial.scope);
    setMembers((search?.members ?? []).map((member) => member.id));
    setKnown((search?.members ?? []).map((member) => ({
      ...member,
      username: member.email,
      job_title: null,
      avatar_url: null,
      initials: initials(member.name),
      is_me: false,
    })));
    setHeir([]);
  }, [open, initial, search, form]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.savedSearches(value.resource_type) });

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const body = {
        ...value,
        ...values,
        scope: values.scope,
        // Sent even when public, so switching back to Shared restores exactly
        // the audience that was there rather than losing it (§5).
        ...(mayShare ? { member_ids: members } : {}),
      };
      return search
        ? explorerApi.updateSaved(search.id, body)
        : explorerApi.createSaved(body);
    },
    onSuccess: async (saved) => {
      settled();
      await invalidate();
      message.success(editing ? "Saved search updated" : "Search saved");
      onSaved(saved);
      onClose();
    },
    onError: (error: Error) => message.error(error.message),
  });

  const transfer = useMutation({
    mutationFn: (ownerId: string) => explorerApi.transferSaved(search!.id, ownerId),
    onSuccess: async (saved) => {
      settled();
      await invalidate();
      message.success(`${saved.name} now belongs to ${saved.owner.name}`);
      onTransferred?.(saved);
      onClose();
    },
    onError: (error: Error) => message.error(error.message),
  });

  return (
    <Modal
      open={open}
      title={editing ? `Edit “${search?.name}”` : "Save this search"}
      okText={editing ? "Save changes" : "Save search"}
      confirmLoading={save.isPending}
      onCancel={requestClose}
      onOk={() =>
        form
          .validateFields()
          .then((values) => save.mutate(values))
          // The missing name is shown on the field; without this the
          // rejection also surfaced as an unhandled error.
          .catch(() => undefined)
      }
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        preserve={false}
        onValuesChange={touch}
      >
        <Form.Item
          name="name"
          label="Name"
          rules={[{ required: true, whitespace: true, max: 200, message: "Give it a name" }]}
        >
          <Input autoFocus placeholder="e.g. Critical work due this week" />
        </Form.Item>
        <Form.Item name="description" label="Description" rules={[{ max: 2000 }]}>
          <Input.TextArea rows={2} placeholder="Why this question matters (optional)" />
        </Form.Item>

        <Form.Item name="scope" label="Visibility">
          <Segmented
            data-testid="saved-search-scope"
            value={scope}
            onChange={(next) => setScope(next)}
            options={SCOPES.map((option) => ({
              value: option.value,
              label: option.label,
              disabled: option.value !== "PRIVATE" && !mayShare,
            }))}
          />
        </Form.Item>
        <Text type="secondary">{SCOPES.find((option) => option.value === scope)?.help}</Text>

        {!mayShare && (
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message="Your role can keep private searches, not publish them"
            description="Sharing needs the “Share saved searches and views” permission."
          />
        )}

        {mayShare && scope !== "PRIVATE" && (
          <Form.Item
            style={{ marginTop: 12 }}
            label="People"
            help={
              scope === "PUBLIC"
                ? "Everyone can see this while it is public. These names are kept for when you switch back to Shared."
                : "Each person can see and run it. Only you can change it."
            }
          >
            <PeoplePicker
              aria-label="Share with"
              data-testid="saved-search-members"
              value={members}
              known={known}
              exclude={search ? [search.owner.id] : []}
              onChange={(ids, people) => {
                setMembers(ids);
                setKnown((current) => [...current, ...people]);
              }}
            />
          </Form.Item>
        )}
      </Form>

      {editing && search?.can_edit && mayShare && (
        <TransferOwnership search={search} heir={heir} onHeir={setHeir} busy={transfer.isPending} onTransfer={(id) => transfer.mutate(id)} />
      )}
    </Modal>
  );
}
