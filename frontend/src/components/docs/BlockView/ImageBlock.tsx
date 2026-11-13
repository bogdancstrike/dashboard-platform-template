import { useQuery } from "@tanstack/react-query";
import { Image, Skeleton, Typography } from "antd";

import type { DocBlock } from "@/api/docs";
import { filesApi } from "@/api/files";
import type { DocumentBlock } from "@/api/reportDocuments";

import { queryKeys } from "@/lib/queryKeys";

const { Text } = Typography;

export function asReportBlock(block: DocBlock): DocumentBlock {
  return {
    ...(block as unknown as DocumentBlock),
    id: block.id,
    kind: block.kind === "report" ? "REPORT" : "CHART",
  };
}

export function ImageBlock({ block }: { block: DocBlock }) {
  const url = useQuery({
    queryKey: queryKeys.filePreview(block.file_id),
    queryFn: ({ signal }) => filesApi.previewUrl(block.file_id!, signal),
    enabled: Boolean(block.file_id),
    staleTime: 240_000,
    retry: false,
  });
  if (!block.file_id) return <Text type="secondary">No image chosen yet.</Text>;
  if (url.isLoading) return <Skeleton.Image active />;
  return (
    <figure className="nx-dc-figure">
      {url.data ? (
        <Image src={url.data.download.url} alt={block.caption || url.data.file.name} />
      ) : (
        <Text type="secondary">The image could not be loaded.</Text>
      )}
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  );
}
