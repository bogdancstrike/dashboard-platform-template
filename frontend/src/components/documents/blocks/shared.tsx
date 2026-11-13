/** What every data block's preview shares: the chart handle the export reads, and the unfinished and refused states. */

import { Typography } from "antd";

import { ApiError } from "@/api/client";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

/** A chart that has been drawn, and can be asked for its own image. */
export type Capturable = { getDataURL: (options?: object) => string } | null;

/** Rows a table block previews. The server draws up to its own limit. */
export const PREVIEW_ROWS = 8;

/**
 * A block that is not finished yet.
 *
 * Distinguished from one that is broken, because only the second is worth an
 * error: the composer adds blocks by *kind* and they are filled in afterwards,
 * so "no dataset chosen" is a normal state on the way to a document (§34).
 */
export function Unfinished({ what }: { what: string }) {
  return (
    <div className="nu-doc-unfinished">
      <EmptyState compact title={<Text type="secondary">{what}</Text>} />
    </div>
  );
}

/**
 * Why one block cannot be drawn, in place and in the document's own flow.
 *
 * The server renders the same situation as a line of text in the exported
 * file rather than failing the whole export, and the preview matches: a
 * document with one honest gap in it beats an export that refuses at the
 * moment somebody is about to send it (§34, §76).
 */
export function Refused({ error, subject }: { error: Error; subject: string }) {
  const api = error instanceof ApiError ? error : null;
  return (
    <p className="nu-doc-refused">
      [
      {api?.isForbidden
        ? `your role does not include ${subject}`
        : (api?.message ?? `${subject} could not be read`)}
      ]
    </p>
  );
}
