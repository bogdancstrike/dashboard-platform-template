import "@/styles/decisions.css";

import { Alert, Button, Skeleton, Space, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import { formsApi, type FormStatus } from "@/api/forms";
import { usePageCommands } from "@/commands/CommandContext";
import { TdIcon } from "@/components/icons/TdIcon";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { errorText } from "@/lib/errors";
import { relativeTime } from "@/lib/time";
import { queryKeys } from "@/lib/queryKeys";

const { Text } = Typography;

export const FORM_STATUS_TONE: Record<FormStatus, string> = {
  DRAFT: "nx-td-pilltag",
  PUBLISHED: "nx-td-pilltag nx-td-pilltag--ok",
  CLOSED: "nx-td-pilltag nx-td-pilltag--warn",
};

/** Intake forms: what each one creates, who can answer it, and how it is doing. */
export default function FormsPage() {
  const navigate = useNavigate();
  const list = useQuery({ queryKey: queryKeys.forms("list"), queryFn: ({ signal }) => formsApi.list(signal) });
  const canManage = Boolean(list.data?.can_manage);
  usePageCommands("forms", canManage ? [{ id: "forms.new", label: "New intake form", run: () => navigate("/admin/forms/new") }] : []);

  if (list.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (list.isError || !list.data) return <Alert type="error" showIcon message={errorText(list.error)} />;
  const data = list.data;
  const live = data.items.filter((item) => item.status === "PUBLISHED").length;
  const week = data.items.reduce((sum, item) => sum + (item.last_week ?? 0), 0);
  const failed = data.items.reduce((sum, item) => sum + (item.failed ?? 0), 0);
  const label = (key: string) => data.targets.find((target) => target.key === key)?.label ?? key;

  return (
    <div className="nx-td" data-testid="forms-page">
      <PageHeader
        title={<>Intake <em>forms</em></>}
        subtitle={`${data.items.length} forms · ${live} published · ${week} answers this week`}
        actions={canManage ? (
          <Link to="/admin/forms/new"><Button type="primary" icon={<NxIcon name="plus" />} data-testid="forms-new">New form</Button></Link>
        ) : undefined}
      />
      <div className="nx-td-kpis">
        <div className="nx-td-kpi"><small>Published</small><strong>{live}</strong><span>taking answers</span></div>
        <div className="nx-td-kpi"><small>This week</small><strong>{week}</strong><span>answers received</span></div>
        <div className="nx-td-kpi"><small>All time</small><strong>{data.items.reduce((sum, item) => sum + item.submission_count, 0)}</strong><span>submissions</span></div>
        <div className="nx-td-kpi"><small>Need a look</small><strong style={{ color: failed ? "var(--nu-bad)" : undefined }}>{failed}</strong><span>did not become records</span></div>
      </div>
      {data.items.length === 0 ? <div className="nx-td-empty">No forms yet.</div> : (
        <div className="nx-td-list">
          {data.items.map((item) => (
            <div key={item.id} className="nx-td-row nx-td-row--nocheck" data-testid="form-row">
              <span className="nx-td-row-icon"><TdIcon name="form" /></span>
              <div className="nx-td-row-main">
                <Link className="nx-td-row-title" to={`/admin/forms/${item.id}`}>{item.name}</Link>
                <div className="nx-td-row-meta">
                  <span>Creates {label(item.target).toLowerCase()}</span>
                  <span>{item.field_count} fields</span>
                  <span className="nx-td-mono">{item.public_path}</span>
                  <span>updated {relativeTime(item.updated_at)}</span>
                </div>
              </div>
              <div className="nx-td-row-side">
                <span className={`nx-td-pilltag nx-td-pilltag--plain${item.visibility === "PUBLIC" ? " nx-td-pilltag--acc" : ""}`}>
                  {item.visibility === "PUBLIC" ? "Public" : "Internal"}
                </span>
                <span className={FORM_STATUS_TONE[item.status]}>{item.status.toLowerCase()}</span>
                <Text className="nx-td-num" type="secondary">{item.submission_count} answers</Text>
                <Space size={4}>
                  {item.status === "PUBLISHED" && (
                    <a href={item.public_path} target="_blank" rel="noreferrer"><Button icon={<TdIcon name="eye" />}>Open</Button></a>
                  )}
                  <Link to={`/admin/forms/${item.id}?tab=submissions`}><Button>Submissions</Button></Link>
                </Space>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
