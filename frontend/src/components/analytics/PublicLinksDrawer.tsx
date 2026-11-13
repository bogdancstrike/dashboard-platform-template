/**
 * Publish a dashboard by link (§25): read-only token links with an optional
 * password, an expiry, revoke, a view count, and an iframe snippet for the
 * origins allowed to embed it. A URL-driven drawer (`?publish=1`).
 */
import "@/styles/analytics.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, DatePicker, Drawer, Empty, Form, Input, Modal, Select, Skeleton, Switch, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { URL_OVERLAY } from "@/app/history";
import { useUrlOverlay } from "@/app/useUrlOverlay";
import { linksApi, type DashboardLink } from "@/api/recordsAnalytics";
import { FailureAlert } from "@/components/FailureAlert";
import { NxIcon } from "@/components/NxIcon";
import { errorText } from "@/lib/errors";
import { absoluteTime, relativeTime } from "@/lib/time";

export function shareUrl(link: Pick<DashboardLink, "path">): string {
  return `${window.location.origin}${link.path}`;
}

export function embedSnippet(link: Pick<DashboardLink, "path" | "label">): string {
  return `<iframe src="${shareUrl(link)}" title="${(link.label || "Nucleus dashboard").replace(/"/g, "&quot;")}" width="100%" height="720" style="border:0;border-radius:16px" loading="lazy"></iframe>`;
}

interface Values {
  label?: string;
  password?: string;
  expires?: Dayjs | null;
  allow_embed: boolean;
  allowed_origins: string[];
}

/** The button and drawer, for a dashboard page's header. */
export function PublishButton({ dashboardId }: { dashboardId: string }) {
  const overlay = useUrlOverlay("publish");
  return (
    <>
      <Button icon={<NxIcon name="globe" />} onClick={() => overlay.open("1")} data-testid="dashboard-publish">
        Public link
      </Button>
      <PublicLinksDrawer dashboardId={dashboardId} open={overlay.value === "1"} onClose={overlay.close} />
    </>
  );
}

export function PublicLinksDrawer({ dashboardId, open, onClose }: { dashboardId: string; open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const key = ["dashboard-links", dashboardId];
  const links = useQuery({ queryKey: key, queryFn: ({ signal }) => linksApi.list(dashboardId, signal), enabled: open });
  const embed = Form.useWatch("allow_embed", form);

  const create = useMutation({
    mutationFn: (values: Values) =>
      linksApi.create(dashboardId, {
        label: values.label || null,
        password: values.password || null,
        expires_at: values.expires ? values.expires.endOf("day").toISOString() : null,
        allow_embed: values.allow_embed,
        allowed_origins: values.allow_embed ? values.allowed_origins ?? [] : [],
      }),
    onSuccess: (link) => {
      void navigator.clipboard?.writeText(shareUrl(link)).catch(() => undefined);
      void message.success("Link published — copied to the clipboard.");
      form.resetFields();
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error) => void message.error(errorText(error, { action: "publish dashboards" })),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => linksApi.revoke(dashboardId, id),
    onSuccess: () => {
      void message.success("Link revoked — it stops working immediately.");
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error) => void message.error(errorText(error)),
  });

  const canPublish = Boolean(links.data?.can_publish);
  const items = links.data?.items ?? [];

  return (
    <Drawer open={open} onClose={onClose} title="Public links" width="min(560px, 100vw)" rootClassName={URL_OVERLAY} destroyOnClose>
      {links.isLoading ? (
        <Skeleton active />
      ) : links.isError ? (
        <FailureAlert error={links.error} />
      ) : (
        <div className="nx-ra-stack">
          <p className="nx-ra-sub" style={{ margin: 0 }}>
            Anyone with a link sees this dashboard read-only, as you see it — without signing in. Personal widgets (mail, tasks,
            notifications) are left out.
          </p>
          {canPublish ? (
            <section className="nx-ra-panel" style={{ padding: 14 }}>
              <Form form={form} layout="vertical" initialValues={{ allow_embed: false, allowed_origins: [] }} onFinish={(v) => create.mutate(v)}>
                <Form.Item name="label" label="Label" style={{ marginBottom: 10 }}>
                  <Input placeholder="Board pack" maxLength={120} data-testid="link-label" />
                </Form.Item>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <Form.Item name="password" label="Password (optional)" style={{ flex: 1, minWidth: 180, marginBottom: 10 }}
                    rules={[{ min: 6, message: "At least 6 characters" }]}>
                    <Input.Password autoComplete="new-password" data-testid="link-password" />
                  </Form.Item>
                  <Form.Item name="expires" label="Expires (optional)" style={{ marginBottom: 10 }}>
                    <DatePicker disabledDate={(d) => d.isBefore(dayjs(), "day")} data-testid="link-expires" />
                  </Form.Item>
                </div>
                <Form.Item name="allow_embed" label="Allow embedding in an iframe" valuePropName="checked" style={{ marginBottom: 10 }}>
                  <Switch />
                </Form.Item>
                {embed && (
                  <Form.Item name="allowed_origins" label="Allowed sites" extra="Only these origins may frame it; empty means any site."
                    style={{ marginBottom: 10 }}>
                    <Select mode="tags" tokenSeparators={[",", " "]} placeholder="https://intranet.example.com" open={false} />
                  </Form.Item>
                )}
                <Button type="primary" htmlType="submit" loading={create.isPending} data-testid="link-create">Publish link</Button>
              </Form>
            </section>
          ) : (
            <p className="nx-ra-muted">Publishing needs “Publish dashboards as public or embeddable links”, on a dashboard you own.</p>
          )}
          {items.length === 0 ? (
            <Empty description="No public links yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            items.map((link) => (
              <article key={link.id} className="nx-ra-link" data-testid="public-link">
                <div className="nx-ra-link-top">
                  <b>{link.label || "Untitled link"}</b>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className={`nx-ra-pill ${link.status === "ACTIVE" ? "nx-ra-pill--ok" : "nx-ra-pill--bad"}`}>{link.status.toLowerCase()}</span>
                    {link.has_password && <span className="nx-ra-pill">password</span>}
                    {link.allow_embed && <span className="nx-ra-pill">embeddable</span>}
                  </span>
                </div>
                <Typography.Text copyable={{ text: shareUrl(link) }} ellipsis style={{ maxWidth: "100%" }}>{shareUrl(link)}</Typography.Text>
                <span className="nx-ra-muted">
                  {link.view_count} view{link.view_count === 1 ? "" : "s"}
                  {link.last_viewed_at ? ` · last ${relativeTime(link.last_viewed_at)}` : ""}
                  {link.expires_at ? ` · expires ${absoluteTime(link.expires_at)}` : " · never expires"}
                  {link.allowed_origins.length ? ` · ${link.allowed_origins.join(", ")}` : ""}
                </span>
                {link.status === "ACTIVE" && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button size="small" href={link.path} target="_blank">Open</Button>
                    {link.allow_embed && (
                      <Button size="small" onClick={() => Modal.info({
                        title: "Embed this dashboard",
                        width: 560,
                        content: <pre className="nx-ra-snippet" data-testid="embed-snippet">{embedSnippet(link)}</pre>,
                        okText: "Done",
                      })}>
                        Embed code
                      </Button>
                    )}
                    {canPublish && (
                      <Button size="small" danger loading={revoke.isPending}
                        onClick={() => Modal.confirm({ title: "Revoke this link?", content: "Anyone using it loses access at once.", okText: "Revoke", okButtonProps: { danger: true }, onOk: () => revoke.mutateAsync(link.id) })}>
                        Revoke
                      </Button>
                    )}
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      )}
    </Drawer>
  );
}
