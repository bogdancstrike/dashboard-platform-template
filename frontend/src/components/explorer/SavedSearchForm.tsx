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
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Typography,
} from "antd";

import { explorerApi, type SavedSearch, type SaveSearchInput } from "@/api/explorer";
import type { Person } from "@/api/directory";
import { useAuth } from "@/auth/AuthProvider";
import { PeoplePicker } from "@/components/PeoplePicker";

const { Text } = Typography;

export type Scope = SavedSearch["scope"];

const SCOPES: Array<{ value: Scope; label: string; help: string }> = [
  { value: "PRIVATE", label: "Private", help: "Only you can see it." },
  { value: "SHARED", label: "Shared", help: "You, plus the people you name below." },
  { value: "PUBLIC", label: "Public", help: "Everyone signed in can find and run it." },
];

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
    queryClient.invalidateQueries({ queryKey: ["saved-searches", value.resource_type] });

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
        : explorerApi.createSaved(body as SaveSearchInput);
    },
    onSuccess: async (saved) => {
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
      onCancel={onClose}
      onOk={() => form.validateFields().then((values) => save.mutate(values))}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={initial} preserve={false}>
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
          <Radio.Group
            data-testid="saved-search-scope"
            optionType="button"
            buttonStyle="solid"
            value={scope}
            onChange={(event) => setScope(event.target.value as Scope)}
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
        <>
          <Divider plain>Ownership</Divider>
          <Space direction="vertical" style={{ width: "100%" }} size={8}>
            <Text type="secondary">
              Owned by {search.owner.name}. Handing it over is permanent: you keep read
              access and lose the ability to change it.
            </Text>
            <PeoplePicker
              aria-label="Transfer ownership to"
              data-testid="saved-search-heir"
              multiple={false}
              value={heir}
              exclude={[search.owner.id]}
              placeholder="Transfer to…"
              onChange={(ids) => setHeir(ids)}
            />
            <Popconfirm
              title="Hand over this saved search?"
              description="You will keep read access and lose the ability to change it."
              okText="Transfer"
              disabled={heir.length === 0}
              onConfirm={() => heir[0] && transfer.mutate(heir[0])}
            >
              <button
                type="button"
                className="nu-link-button nu-danger-link"
                disabled={heir.length === 0 || transfer.isPending}
              >
                Transfer ownership
              </button>
            </Popconfirm>
          </Space>
        </>
      )}
    </Modal>
  );
}

function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "")).toUpperCase();
}
