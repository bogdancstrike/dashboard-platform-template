import { useQuery } from "@tanstack/react-query";
import { List, Space, Typography } from "antd";
import { FileOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { filesApi } from "@/api/files";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { Loading, MoreLink, Nothing, ROWS, type ModuleBodyProps } from "./shared";

const { Text } = Typography;

/** What has been uploaded lately, largest facts first: name, size, when. */
export function FilesBody({ widget, fallback }: ModuleBodyProps) {
  const params = {
    ...(widget.config.folder_id ? { folder_id: widget.config.folder_id } : {}),
    page_size: ROWS,
  };

  const page = useQuery({
    queryKey: queryKeys.files(params),
    queryFn: ({ signal }) => filesApi.list(params, signal),
    staleTime: STALE.short,
  });

  if (page.isLoading) return <Loading />;
  if (page.isError) return fallback(page.error, "files");

  const items = page.data?.items ?? [];
  if (items.length === 0) return <Nothing what="No files here yet" />;

  return (
    <>
      <List
        size="small"
        dataSource={items}
        renderItem={(file) => (
          <List.Item>
            <Link to="/files" className="nu-widget-row">
              <Space size={6} className="nu-widget-file">
                <FileOutlined aria-hidden />
                <Text ellipsis>{file.name}</Text>
              </Space>
              <Text type="secondary" className="nu-widget-dim">
                {bytes(file.size_bytes)}
              </Text>
            </Link>
          </List.Item>
        )}
      />
      <MoreLink to="/files">All {(page.data?.total ?? 0).toLocaleString()} files</MoreLink>
    </>
  );
}

/** Sizes the way a file manager writes them, not in raw bytes. */
function bytes(value: number | null | undefined): string {
  const size = Number(value ?? 0);
  if (!size) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  const scaled = size / 1024 ** index;
  return `${scaled >= 10 || index === 0 ? Math.round(scaled) : scaled.toFixed(1)} ${units[index]}`;
}
