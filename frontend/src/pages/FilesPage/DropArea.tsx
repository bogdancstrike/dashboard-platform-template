import { InboxOutlined } from "@ant-design/icons";
import { useState } from "react";

import { readableSize } from "@/api/files";

/**
 * The file list, which is also where files are dropped.
 *
 * A dedicated drop panel is chrome that is read once and then occupies a tenth
 * of the page forever — and on a folder with one file in it, the instructions
 * were taller than the content. So the list itself takes the drop and says so
 * only while something is being dragged over it, with the *permanent* way to
 * upload being the button in the header.
 *
 * Written here rather than with `Upload.Dragger` because the dragger is a
 * bordered, centred box with its own padding: everything that makes it a good
 * panel makes it a bad wrapper for a table. The events are four lines, and the
 * hidden input a table cannot supply lives on the header's `Upload`.
 */
export function DropArea({
  enabled,
  limit,
  onFiles,
  children,
}: {
  enabled: boolean;
  limit: number;
  onFiles: (file: File) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);

  if (!enabled) return <>{children}</>;

  return (
    <div
      className={`nu-drop-area${over ? " is-over" : ""}`}
      data-testid="dropzone"
      // `dragover` must be cancelled or the browser navigates to the file.
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        // Only when the pointer has left the area itself: a `dragleave` fires
        // for every child it crosses, which flickers the hint off and on.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        for (const file of Array.from(event.dataTransfer.files)) onFiles(file);
      }}
    >
      {children}
      {over && (
        <div className="nu-drop-hint" aria-hidden>
          <InboxOutlined />
          <span>
            Drop to upload · up to {readableSize(limit)} each · executables refused before
            anything is transferred
          </span>
        </div>
      )}
    </div>
  );
}
