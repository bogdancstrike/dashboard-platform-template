import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import type { StoredFile } from "@/api/files";
import { FilePreview, TEXT_LIMIT, previewKind } from "@/components/files/FilePreview";
import { CommandProvider } from "@/commands/CommandContext";
import FilesPage from "@/pages/FilesPage";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";
import { storedFiles } from "@/test/handlers";

/**
 * A file shown rather than downloaded (§20, §64).
 *
 * The claims:
 *
 * **Three kinds preview, and the rest say so.** An image, a PDF and text are
 * what a browser renders without a library. A spreadsheet cannot be shown
 * honestly, and an empty frame that looks broken is worse than a sentence
 * saying to download it.
 *
 * **An SVG is a download, not an image.** A browser *executes* it: it can
 * carry script, and one uploaded by a colleague is not a document this
 * application should run inside its own origin.
 *
 * **A preview is not a download.** It asks for the same object with one word
 * of its disposition changed, and the server does not count it — the number
 * beside a file is how many times it was taken away.
 *
 * **The address carries the file**, so "copy link" copies something that
 * still works tomorrow rather than a presigned URL that expires in minutes.
 */

const file = (overrides: Partial<StoredFile> = {}): StoredFile => ({
  id: "file-x",
  name: "Floorplan.png",
  extension: "png",
  mime_type: "image/png",
  kind: "IMAGE",
  size_bytes: 2048,
  checksum: "abc123",
  folder_id: "folder-1",
  status: "READY",
  version: 1,
  download_count: 0,
  preview_text: null,
  owner: "Ada Administrator",
  created_at: "2026-09-01T09:00:00Z",
  last_accessed_at: null,
  ...overrides,
});

function render(subject: StoredFile) {
  return renderWithProviders(
    <FilePreview open file={subject} onClose={vi.fn()} onDownload={vi.fn()} />,
  );
}

describe("what can be shown", () => {
  it("shows an image, a PDF and text, and refuses the rest", () => {
    expect(previewKind(file())).toBe("image");
    expect(previewKind(file({ extension: "pdf", kind: "DOCUMENT" }))).toBe("pdf");
    expect(previewKind(file({ extension: "md", kind: "DOCUMENT" }))).toBe("text");
    expect(previewKind(file({ extension: "csv", kind: "SPREADSHEET" }))).toBe("text");
    expect(previewKind(file({ extension: "xlsx", kind: "SPREADSHEET" }))).toBe("none");
    expect(previewKind(file({ extension: "zip", kind: "ARCHIVE" }))).toBe("none");
  });

  it("treats an SVG as a download, because a browser executes one", () => {
    expect(previewKind(file({ extension: "svg", kind: "IMAGE" }))).toBe("none");
  });
});

describe("the pane", () => {
  it("points an image at the inline URL rather than fetching the bytes", async () => {
    const asked: string[] = [];
    server.use(
      http.get("/platform/api/files/:id", ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json({
          file: file(),
          download: { url: "https://storage.example/x?signed=1&inline=1", method: "GET", expires_in: 900 },
        });
      }),
    );
    render(file());

    const image = await screen.findByTestId("file-preview-image");
    expect(image).toHaveAttribute("src", "https://storage.example/x?signed=1&inline=1");
    // `inline`, which is the whole difference between showing and saving.
    expect(asked[0]).toContain("inline=true");
  });

  it("frames a PDF", async () => {
    render(file({ extension: "pdf", kind: "DOCUMENT", name: "Contract.pdf" }));
    expect(await screen.findByTestId("file-preview-pdf")).toHaveAttribute(
      "title",
      "Contract.pdf",
    );
  });

  it("reads a text file and caps it", async () => {
    const body = `first line\n${"x".repeat(TEXT_LIMIT)}`;
    // Answered through the mock server rather than by spying on `fetch`: MSW
    // owns `fetch` in this suite, and a spy over it is a test of the spy.
    server.use(
      http.get("/platform/api/files/:id", () =>
        HttpResponse.json({
          file: file({ extension: "md", kind: "DOCUMENT", name: "notes.md" }),
          download: { url: "https://storage.example/notes.md?signed=1", method: "GET", expires_in: 900 },
        }),
      ),
      http.get("https://storage.example/notes.md", () => HttpResponse.text(body)),
    );
    render(file({ extension: "md", kind: "DOCUMENT", name: "notes.md", size_bytes: body.length }));

    const shown = await screen.findByTestId("file-preview-text");
    expect(shown.textContent).toContain("first line");
    // A 40 MB log is not a preview, and the pane says how much it showed.
    expect(shown.textContent?.length).toBe(TEXT_LIMIT);
    expect(await screen.findByText(/download it for the rest/)).toBeInTheDocument();
  });

  it("says so rather than framing nothing, for a kind it cannot show", async () => {
    render(file({ extension: "xlsx", kind: "SPREADSHEET", name: "Q3.xlsx" }));

    const frame = await screen.findByTestId("file-preview-frame");
    expect(frame).toHaveTextContent(/cannot be shown here/);
    expect(within(frame).getByRole("button", { name: /Download Q3.xlsx/ })).toBeInTheDocument();
  });

  it("says what went wrong when the link cannot be got", async () => {
    server.use(
      http.get("/platform/api/files/:id", () =>
        HttpResponse.json(
          { error: "not_found", message: "The record is here but the file is not in storage.", details: {} },
          { status: 404 },
        ),
      ),
    );
    render(file());

    expect(await screen.findByText(/could not be opened/)).toBeInTheDocument();
    expect(await screen.findByText(/not in storage/)).toBeInTheDocument();
  });

  it("copies a link to the page, not the presigned URL", async () => {
    // Read back from Testing Library's own clipboard stub: `userEvent.setup()`
    // installs one, so a stub defined before it is overwritten and a test
    // that checks its own array measures nothing.
    const user = userEvent.setup();
    render(file({ id: "file-7" }));

    await user.click(screen.getByTestId("file-copy-link"));

    // A signed URL expires in minutes: pasting one into a message is a link
    // that works for the sender and fails for the reader.
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toBe(
        `${window.location.origin}/files?file=file-7`,
      ),
    );
  });
});

function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.search}</span>;
}

describe("on the page", () => {
  it("opens from a row, and the address says which file", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CommandProvider>
        <Address />
        <Routes>
          <Route path="/files" element={<FilesPage />} />
        </Routes>
      </CommandProvider>,
      { route: "/files" },
    );

    const row = await screen.findByText(storedFiles[1]!["name"] as string);
    await user.click(row);

    // In the address, so "look at this one" is a link and the back button
    // closes the pane (§69).
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("file=file-2"),
    );
    expect(await screen.findByTestId("file-preview")).toBeInTheDocument();
  });

  it("opens straight from a pasted address", async () => {
    renderWithProviders(
      <CommandProvider>
        <Routes>
          <Route path="/files" element={<FilesPage />} />
        </Routes>
      </CommandProvider>,
      { route: "/files?folder=folder-1&file=file-3" },
    );

    const pane = await screen.findByTestId("file-preview");
    expect(pane).toHaveTextContent("Mara Manager");
  });
});
