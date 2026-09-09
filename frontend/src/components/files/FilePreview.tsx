import { useQuery } from "@tanstack/react-query";
import { App as AntApp, Button, Descriptions, Drawer, Space, Typography } from "antd";
import { DownloadOutlined, LinkOutlined } from "@ant-design/icons";

import { filesApi, readableSize, type StoredFile } from "@/api/files";
import { EmptyState } from "@/components/EmptyState";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text, Paragraph } = Typography;

/**
 * One file, shown rather than downloaded (§20, §64).
 *
 * Four decisions worth the reader's attention.
 *
 * **The bytes still bypass the API.** The preview asks for the same presigned
 * URL a download asks for, with one word of its disposition changed — `inline`
 * instead of `attachment`. A preview that streamed through a worker would put
 * a 400 MB file back on the thing presigned URLs exist to keep it off.
 *
 * **Three kinds preview, and the rest say so.** An image, a PDF and text are
 * what a browser renders without a library; a spreadsheet or an archive cannot
 * be shown honestly, so the pane offers the download rather than an empty
 * frame that looks broken.
 *
 * **Text is fetched; an image and a PDF are pointed at.** `<img>` and
 * `<iframe>` need no CORS, and reading bytes with `fetch` does — object
 * storage allows it for a signed GET. Capped, because a 40 MB log is not a
 * preview.
 *
 * **The address carries the file.** `/files?file=<id>` is what "copy link"
 * copies — never the presigned URL, which expires in minutes and would be a
 * link that works for the sender and fails for everybody they sent it to.
 */

/** How much of a text file is a preview rather than a download. */
export const TEXT_LIMIT = 64 * 1024;

/** What a browser can show without pretending. */
export function previewKind(file: StoredFile): "image" | "pdf" | "text" | "none" {
  const extension = (file.extension ?? "").toLowerCase();
  // An SVG is an image a browser will *execute*: it can carry script, and one
  // uploaded by a colleague is not a document this app should run inside its
  // own origin. Offered as a download instead.
  if (file.kind === "IMAGE" && extension !== "svg") return "image";
  if (extension === "pdf") return "pdf";
  if (["txt", "md", "csv", "tsv", "json", "xml", "yaml", "yml", "sql", "log"].includes(extension)) {
    return "text";
  }
  return "none";
}

export function FilePreview({
  file,
  open,
  onClose,
  onDownload,
}: {
  file: StoredFile | null;
  open: boolean;
  onClose: () => void;
  onDownload: (file: StoredFile) => void;
}) {
  const { message } = AntApp.useApp();
  const kind = file ? previewKind(file) : "none";

  const link = useQuery({
    queryKey: ["file-preview", file?.id],
    queryFn: ({ signal }) => filesApi.previewUrl(file!.id, signal),
    enabled: Boolean(open && file && kind !== "none"),
    // Presigned and short-lived, so it is refetched rather than kept past its
    // own expiry — a cached URL is a link that has stopped working.
    staleTime: 60_000,
    retry: false,
  });

  const body = useQuery({
    queryKey: ["file-preview-text", file?.id, link.data?.download.url],
    queryFn: async () => {
      const response = await fetch(link.data!.download.url);
      if (!response.ok) throw new Error(`The file could not be read (${response.status}).`);
      const text = await response.text();
      return { text: text.slice(0, TEXT_LIMIT), truncated: text.length > TEXT_LIMIT };
    },
    enabled: Boolean(open && kind === "text" && link.data),
    retry: false,
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={720}
      title={file?.name ?? "Preview"}
      extra={
        file && (
          <Space size={6}>
            <Button
              size="small"
              icon={<LinkOutlined />}
              data-testid="file-copy-link"
              onClick={() => {
                const address = `${window.location.origin}/files?file=${file.id}`;
                // The DOM types promise `clipboard` is always there; a page
                // served over plain HTTP disagrees, and so does a browser
                // that has refused the permission — hence the catch rather
                // than an optional call the type checker calls unnecessary.
                void navigator.clipboard
                  .writeText(address)
                  .then(() => message.success("Link copied"))
                  .catch(() => message.error("This browser would not let us copy."));
              }}
            >
              Copy link
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              data-testid="file-preview-download"
              onClick={() => onDownload(file)}
            >
              Download
            </Button>
          </Space>
        )
      }
    >
      {file && (
        <div data-testid="file-preview">
          <div className="nu-preview-frame" data-testid="file-preview-frame">
            {kind === "none" && (
              <EmptyState
                title={`A ${file.kind.toLowerCase()} cannot be shown here`}
                hint="Download it and open it where it belongs — an empty frame that looks broken is worse than saying so."
                action={
                  <Button size="small" onClick={() => onDownload(file)}>
                    Download {file.name}
                  </Button>
                }
              />
            )}
            {kind !== "none" && link.isError && (
              <EmptyState
                title="That file could not be opened"
                hint={link.error instanceof Error ? link.error.message : undefined}
              />
            )}
            {kind === "image" && link.data && (
              <img
                className="nu-preview-image"
                src={link.data.download.url}
                alt={file.name}
                data-testid="file-preview-image"
              />
            )}
            {kind === "pdf" && link.data && (
              <iframe
                className="nu-preview-pdf"
                src={link.data.download.url}
                title={file.name}
                data-testid="file-preview-pdf"
              />
            )}
            {kind === "text" && (
              <>
                {body.isError && (
                  <EmptyState
                    title="That file could not be read"
                    hint={body.error instanceof Error ? body.error.message : undefined}
                  />
                )}
                {body.data && (
                  <pre className="nu-preview-text" data-testid="file-preview-text">
                    {body.data.text}
                  </pre>
                )}
                {body.data?.truncated && (
                  <Text type="secondary">
                    The first {readableSize(TEXT_LIMIT)} of {readableSize(file.size_bytes)} —
                    download it for the rest.
                  </Text>
                )}
              </>
            )}
          </div>

          <Descriptions size="small" column={1} className="nu-block" bordered>
            <Descriptions.Item label="Kind">{file.kind}</Descriptions.Item>
            <Descriptions.Item label="Size">{readableSize(file.size_bytes)}</Descriptions.Item>
            <Descriptions.Item label="Owner">{file.owner}</Descriptions.Item>
            <Descriptions.Item label="Added">{absoluteTime(file.created_at)}</Descriptions.Item>
            <Descriptions.Item label="Last opened">
              {file.last_accessed_at ? relativeTime(file.last_accessed_at) : "Never"}
            </Descriptions.Item>
            <Descriptions.Item label="Downloads">{file.download_count}</Descriptions.Item>
            {file.checksum && (
              <Descriptions.Item label="Checksum">
                {/* The whole digest, copyable: half of one proves nothing. */}
                <Text code copyable={{ text: file.checksum }}>
                  {file.checksum.slice(0, 16)}…
                </Text>
              </Descriptions.Item>
            )}
          </Descriptions>

          {file.preview_text && (
            <Paragraph type="secondary" className="nu-block">
              {file.preview_text}
            </Paragraph>
          )}
        </div>
      )}
    </Drawer>
  );
}
