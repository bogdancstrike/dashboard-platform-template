/**
 * Fetch a complete record beside its search results (§64).
 *
 * The URL owns identity; the record API owns content. A projected table row is
 * never used as detail data, so hiding a column cannot hide the article body.
 * Requests are scoped by resource and ID and cancelled when selection changes.
 */
import { useQuery } from "@tanstack/react-query";
import { App, Button, Drawer, Skeleton, Space, Tabs, Tag, Tooltip, Typography } from "antd";
import { ApartmentOutlined, CopyOutlined, ExportOutlined, LinkOutlined } from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";

import { recordsApi } from "@/api/records";
import { FavoriteStar } from "@/components/records/FavoriteStar";
import { TagPicker } from "@/components/records/TagPicker";
import { knownStatusColor } from "@/theme/tokens";
import { RecordContent } from "./RecordContent";
import { RecordReadError } from "./RecordReadError";
import { RecordRelations } from "./RecordRelations";

export interface RecordPreviewProps {
  resourceType: string;
  recordId: string;
  term?: string;
  onClose: () => void;
}

export function RecordPreview({ resourceType, recordId, term = "", onClose }: RecordPreviewProps) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const record = useQuery({
    queryKey: ["record", resourceType, recordId],
    queryFn: ({ signal }) => recordsApi.get(resourceType, recordId, signal),
    enabled: Boolean(resourceType && recordId),
  });
  const data = record.data;

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(`${label} copied`);
    } catch {
      message.warning("Your browser would not let the page copy that");
    }
  };

  return (
    <Drawer
      rootClassName="nu-record-drawer"
      open={Boolean(recordId)}
      width="min(680px, 96vw)"
      onClose={onClose}
      title={<span role="heading" aria-level={2} className="nu-preview-title">{data?.title ?? "Record preview"}</span>}
      extra={<Space size={4}>
        {/* Starring from where the record is, rather than from a page that
            lists it. `/favorites` reads one store and everything that stars
            writes to it (§38). */}
        {data && (
          <FavoriteStar
            resourceType={resourceType}
            recordId={recordId}
            label={data.title || recordId.slice(0, 8)}
            url={`${data.path}/${data.id}`}
            size="middle"
          />
        )}
        <Tooltip title="Copy record ID">
          <Button icon={<CopyOutlined />} aria-label="Copy record id"
            onClick={() => void copy(recordId, "Record id")} />
        </Tooltip>
        <Tooltip title="Copy a link to this record and search">
          <Button icon={<LinkOutlined />} aria-label="Copy link to this view"
            onClick={() => void copy(window.location.href, "Link")} />
        </Tooltip>
      </Space>}
    >
      {record.isLoading && <Skeleton active paragraph={{ rows: 12 }} />}
      {record.isError && <RecordReadError error={record.error} onRetry={() => void record.refetch()} />}
      {data && !record.isError && <>
        <Space wrap size={8} className="nu-preview-summary">
          <Typography.Text type="secondary">{data.resource_label}</Typography.Text>
          {data.subtitle && <Typography.Text code>{data.subtitle}</Typography.Text>}
          {data.status && <Tag style={{ borderInlineStart: `3px solid ${knownStatusColor(data.status) ?? "var(--nu-border)"}` }}>{data.status}</Tag>}
          <Link to={`${data.path}/${data.id}`}><ExportOutlined /> Open full record</Link>
          <Button type="text" aria-label="Show connections" icon={<ApartmentOutlined />}
            onClick={() => navigate(`/find/relationships?resource=${resourceType}&id=${recordId}`)}>
            Connections
          </Button>
        </Space>
        {/* Tags, on the record rather than only on the record's own page.
            The explorer is where somebody *finds* the thing they want to
            label, and making them open a second screen to label it is how a
            vocabulary stays unused. Written through the same endpoint
            `/admin/tags` counts, so a tag applied here appears there with its
            usage incremented — one store, one count (§37). */}
        <TagPicker resourceType={resourceType} recordId={recordId} listPath={data.path} />
        <Tabs key={`${resourceType}:${recordId}`} defaultActiveKey="record" items={[
          { key: "record", label: "Record", children: <RecordContent record={data} term={term} /> },
          { key: "related", label: "Related records", children:
            <RecordRelations resourceType={resourceType} recordId={recordId} /> },
        ]} />
      </>}
    </Drawer>
  );
}
