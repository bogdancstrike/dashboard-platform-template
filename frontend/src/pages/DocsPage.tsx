/**
 * `/docs` and `/docs/<page>` — the wiki (§48–49).
 *
 * The space and its tree on the left, the page (or, with no page, the
 * recently changed ones and every space) on the right. The page is the
 * address, pushed; the space being browsed and the search are filters,
 * replaced; history is `?history=1`, so back closes it first.
 *
 * On a phone the tree is a drawer behind a "Pages" button: a tree beside a
 * page in 390 pixels is two unreadable columns.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Card, Drawer, Empty, Form, Grid, Input, Modal, Select, Skeleton, Space, Typography } from "antd";
import { MenuOutlined, PlusOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { docsApi, type DocPage, type DocSpace } from "@/api/docs";
import { usePageCommands } from "@/commands/CommandContext";
import { PageHeader } from "@/components/PageHeader";
import { HighlightedText } from "@/components/HighlightedText";
import { DocView } from "@/components/docs/DocView";
import { NewPageModal } from "@/components/docs/NewPageModal";
import { PageTree, type MoveRequest } from "@/components/docs/PageTree";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { relativeTime } from "@/lib/time";
import "@/styles/collab.css";
import "@/styles/docs.css";

const { Text } = Typography;

export default function DocsPage() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const screens = Grid.useBreakpoint();
  const phone = !screens.md;
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [spacing, setSpacing] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const query = params.get("q") ?? "";
  const term = useDebouncedValue(query.trim(), 250);

  const spaces = useQuery({ queryKey: ["doc-spaces"], queryFn: ({ signal }) => docsApi.spaces(signal) });
  const current = useQuery({
    queryKey: ["doc-page", pageId],
    queryFn: ({ signal }) => docsApi.page(pageId!, signal),
    enabled: Boolean(pageId),
  });
  const spaceId = current.data?.space.id ?? params.get("space") ?? spaces.data?.items.find((s) => s.kind === "GENERAL")?.id ?? spaces.data?.items[0]?.id;
  const tree = useQuery({
    queryKey: ["doc-tree", spaceId],
    queryFn: ({ signal }) => docsApi.tree(spaceId!, signal),
    enabled: Boolean(spaceId),
  });
  const recent = useQuery({
    queryKey: ["doc-recent"],
    queryFn: ({ signal }) => docsApi.recent(signal),
    enabled: !pageId,
  });
  const results = useQuery({
    queryKey: ["doc-search", term],
    queryFn: ({ signal }) => docsApi.search(term, signal),
    enabled: term.length >= 2,
  });

  useEffect(() => setTreeOpen(false), [pageId]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const move = useMutation({
    mutationFn: (request: MoveRequest) => {
      const { id, ...rest } = request;
      return docsApi.move(id, rest);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["doc-tree", spaceId] }),
    onError: (error) => message.error(error instanceof ApiError ? error.message : "The page was not moved."),
  });

  const canEdit = spaces.data?.can_edit ?? false;
  usePageCommands(
    "docs",
    canEdit ? [{ id: "docs.new", label: "Write a new wiki page", keywords: "docs wiki page new write", run: () => setCreating(true) }] : [],
  );

  const opened = (page: DocPage) => {
    setCreating(false);
    void queryClient.invalidateQueries({ queryKey: ["doc-tree", page.space.id] });
    void queryClient.invalidateQueries({ queryKey: ["doc-spaces"] });
    navigate(`/docs/${page.id}?edit=1`);
  };

  const spaceList = spaces.data?.items ?? [];
  const space = spaceList.find((item) => item.id === spaceId);

  const rail = (
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

  return (
    <div className="nx-dc-page">
      <PageHeader
        title={
          <>
            Team <em>docs</em>
          </>
        }
        subtitle="Runbooks, specs, meeting notes and decisions — linked to the records they are about."
        actions={
          <Space wrap>
            {phone && (
              <Button icon={<MenuOutlined />} onClick={() => setTreeOpen(true)} data-testid="docs-pages">
                Pages
              </Button>
            )}
            {canEdit && !phone && (
              <Button onClick={() => setSpacing(true)} data-testid="new-space">
                New space
              </Button>
            )}
            {canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)} data-testid="new-page">
                New page
              </Button>
            )}
          </Space>
        }
      />

      <div className={`nx-dc-layout${phone ? " is-phone" : ""}`}>
        {!phone && <Card className="nx-dc-card nx-dc-rail-card">{rail}</Card>}
        <div className="nx-dc-content">
          {pageId ? (
            <DocView
              pageId={pageId}
              onDeleted={(id) => {
                void queryClient.invalidateQueries({ queryKey: ["doc-tree", id] });
                navigate(`/docs?space=${id}`, { replace: true });
              }}
            />
          ) : term.length >= 2 ? (
            <Card className="nx-dc-card" title={`Pages matching “${term}”`} data-testid="docs-results">
              {results.isLoading ? (
                <Skeleton active />
              ) : (results.data?.items ?? []).length === 0 ? (
                <Empty description="No page says that" />
              ) : (
                <ul className="nx-dc-results">
                  {results.data!.items.map((item) => (
                    <li key={item.id}>
                      <Link to={`/docs/${item.id}`}>
                        <span aria-hidden>{item.icon ?? "📄"}</span> <HighlightedText text={item.title} term={term} />
                      </Link>
                      <Text type="secondary" className="nx-dc-result-where">
                        {item.space} · {relativeTime(item.updated_at)}
                      </Text>
                      {item.snippet && (
                        <p className="nx-dc-snippet">
                          <HighlightedText text={item.snippet} term={term} />
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : (
            <DocsHome spaces={spaceList} recent={recent.data?.items} loading={recent.isLoading} current={space} />
          )}
        </div>
      </div>

      {phone && (
        <Drawer open={treeOpen} onClose={() => setTreeOpen(false)} placement="left" width="86%" title="Pages">
          {rail}
        </Drawer>
      )}

      <NewPageModal
        open={creating}
        spaces={spaceList}
        spaceId={spaceId}
        parentId={pageId && current.data?.space.id === spaceId ? pageId : null}
        pages={tree.data?.items ?? []}
        onClose={() => setCreating(false)}
        onCreated={opened}
      />
      <NewSpaceModal
        open={spacing}
        onClose={() => setSpacing(false)}
        onCreated={(created) => {
          setSpacing(false);
          void queryClient.invalidateQueries({ queryKey: ["doc-spaces"] });
          navigate(`/docs?space=${created.id}`);
        }}
      />
    </div>
  );
}

function DocsHome({
  spaces,
  recent,
  loading,
  current,
}: {
  spaces: DocSpace[];
  recent?: Array<{ id: string; title: string; icon: string | null; space: string; updated_at: string; is_meeting?: boolean; updated_by?: { name: string } | null }>;
  loading: boolean;
  current?: DocSpace;
}) {
  const ordered = useMemo(() => [...spaces].sort((a, b) => Number(b.id === current?.id) - Number(a.id === current?.id)), [spaces, current]);
  return (
    <div className="nx-dc-home" data-testid="docs-home">
      <section>
        <h3 className="nx-dc-section">Spaces</h3>
        <div className="nx-dc-spaces">
          {ordered.map((item) => (
            <Link key={item.id} to={`/docs?space=${item.id}`} className={`nx-dc-space${item.id === current?.id ? " is-on" : ""}`} style={{ ["--space" as string]: item.color }}>
              <span className="nx-dc-space-icon" aria-hidden>{item.icon ?? "📚"}</span>
              <strong>{item.name}</strong>
              <span className="nx-co-muted">{item.description}</span>
              <span className="nx-dc-space-count">
                {item.page_count} page{item.page_count === 1 ? "" : "s"}
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <h3 className="nx-dc-section">Recently updated</h3>
        <Card className="nx-dc-card">
          {loading ? (
            <Skeleton active />
          ) : (recent ?? []).length === 0 ? (
            <Empty description="Nothing written yet" />
          ) : (
            <ul className="nx-dc-recent">
              {recent!.map((item) => (
                <li key={item.id}>
                  <Link to={`/docs/${item.id}`}>
                    <span aria-hidden className="nx-dc-recent-icon">{item.icon ?? (item.is_meeting ? "🗓️" : "📄")}</span>
                    <span className="nx-dc-recent-title">{item.title}</span>
                  </Link>
                  <Text type="secondary" className="nx-dc-recent-meta">
                    {item.space} · {item.updated_by?.name ? `${item.updated_by.name} · ` : ""}
                    {relativeTime(item.updated_at)}
                  </Text>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function NewSpaceModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (space: DocSpace) => void }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<{ name: string; description: string; icon: string }>();
  const create = useMutation({
    mutationFn: (values: { name: string; description: string; icon: string }) => docsApi.createSpace(values),
    onSuccess: (space) => {
      form.resetFields();
      onCreated(space);
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : "The space was not created."),
  });
  return (
    <Modal open={open} title="New space" okText="Create space" onCancel={onClose} onOk={() => form.submit()} confirmLoading={create.isPending} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(values) => create.mutate(values)}>
        <Form.Item name="name" label="Name" rules={[{ required: true, message: "A space needs a name." }]}>
          <Input maxLength={120} aria-label="Space name" />
        </Form.Item>
        <Form.Item name="icon" label="Icon">
          <Input maxLength={4} placeholder="📚" aria-label="Space icon" style={{ width: 90 }} />
        </Form.Item>
        <Form.Item name="description" label="What it is for">
          <Input.TextArea maxLength={400} autoSize={{ minRows: 2 }} aria-label="Space description" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
