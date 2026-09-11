import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";

import FilesPage from "@/pages/FilesPage";
import { CommandProvider } from "@/commands/CommandContext";
import { resetFiles, storedFiles } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

/**
 * The file manager (§20).
 *
 * What is worth asserting is the part that makes it a file manager rather than
 * a form: an upload is two phases and the second one is *not skipped*, the
 * bytes go to the URL the API handed out rather than through the API, and a
 * download opens a signed URL instead of streaming.
 */
function render(route = "/files") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/files" element={<FilesPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

/**
 * `XMLHttpRequest`, stubbed at the boundary the client actually uses.
 *
 * `putBytes` reaches for XHR because `fetch` has no upload-progress event, so
 * MSW — which intercepts `fetch` — never sees it. Recording the calls here is
 * what lets the test assert the bytes went to storage and not to the API.
 */
/** AntD's dragger renders its own hidden file input; this is that input. */
function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("the dropzone has no file input");
  return input;
}

function captureUploads(): { url: string; body: unknown }[] {
  const sent: { url: string; body: unknown }[] = [];
  class FakeXhr {
    status = 200;
    upload = { addEventListener: (_kind: string, _fn: () => void) => {} };
    private handlers: Record<string, (() => void)[]> = {};
    private url = "";
    open(_method: string, url: string) {
      this.url = url;
    }
    setRequestHeader() {}
    addEventListener(kind: string, handler: () => void) {
      this.handlers[kind] = [...(this.handlers[kind] ?? []), handler];
    }
    send(body: unknown) {
      sent.push({ url: this.url, body });
      for (const handler of this.handlers["load"] ?? []) handler();
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return sent;
}

beforeEach(() => resetFiles());
afterEach(() => vi.unstubAllGlobals());

describe("the file manager", () => {
  it("shows the folder tree and what is in the open folder", async () => {
    render();

    const tree = await screen.findByTestId("folder-tree");
    expect(within(tree).getByText("Contracts")).toBeInTheDocument();
    // A materialised path, nested here — the child appears under its parent.
    expect(within(tree).getByText("Signed")).toBeInTheDocument();
    expect(within(tree).getByText("Unfiled")).toBeInTheDocument();
  });

  it("uploads to the URL the API handed out, not through the API", async () => {
    const user = userEvent.setup();
    const sent = captureUploads();
    render();

    await screen.findByTestId("dropzone");
    await user.upload(
      fileInput(),
      new File(["# notes"], "notes.md", { type: "text/markdown" }),
    );

    // Straight at storage: the whole point of a presigned upload.
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.url).toBe("https://storage.example/nucleus/generated-key");

    // And then confirmed, so the file becomes visible as READY rather than
    // being taken on trust.
    await waitFor(() => {
      const added = storedFiles.find((file) => file["name"] === "notes.md");
      expect(added?.["status"]).toBe("READY");
    });
  });

  it("reports each upload separately, with its own progress", async () => {
    const user = userEvent.setup();
    captureUploads();
    render();

    await screen.findByTestId("dropzone");
    await user.upload(fileInput(), [
      new File(["one"], "one.txt", { type: "text/plain" }),
      new File(["two"], "two.txt", { type: "text/plain" }),
    ]);

    // Two rows, not one bar: a failure has to name the file it happened to.
    const tray = await screen.findByTestId("upload-tray");
    expect(await within(tray).findByText("one.txt")).toBeInTheDocument();
    expect(within(tray).getByText("two.txt")).toBeInTheDocument();
  });

  it("says which file could not be uploaded, and leaves the rest alone", async () => {
    const user = userEvent.setup();
    class RefusingXhr {
      status = 403;
      upload = { addEventListener: () => {} };
      private handlers: Record<string, (() => void)[]> = {};
      open() {}
      setRequestHeader() {}
      addEventListener(kind: string, handler: () => void) {
        this.handlers[kind] = [...(this.handlers[kind] ?? []), handler];
      }
      send() {
        for (const handler of this.handlers["load"] ?? []) handler();
      }
    }
    vi.stubGlobal("XMLHttpRequest", RefusingXhr);
    render();

    await screen.findByTestId("dropzone");
    await user.upload(fileInput(), new File(["x"], "refused.txt", { type: "text/plain" }));

    const tray = await screen.findByTestId("upload-tray");
    expect(await within(tray).findByText(/Storage refused the upload \(403\)/)).toBeInTheDocument();
    // Never confirmed, so it does not appear as a file anybody can open.
    expect(storedFiles.find((file) => file["name"] === "refused.txt")?.["status"]).toBe(
      "UPLOADING",
    );
  });

  it("downloads by following the signed URL rather than streaming", async () => {
    const user = userEvent.setup();
    // An anchor, not `window.open`: the signed URL carries
    // `Content-Disposition: attachment`, and a popup for a download is what
    // popup blockers exist to stop.
    const followed: string[] = [];
    // Spied rather than swapped: `restoreMocks` in the vitest config puts the
    // prototype back, and reading a prototype method into a variable to
    // restore it by hand is the detached-`this` hazard the linter warns about.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function capture(
      this: HTMLAnchorElement,
    ) {
      followed.push(this.href);
    });
    render();

    await user.click(await screen.findByLabelText("Download Statement of work 2026-03.pdf"));
    await waitFor(() => expect(followed).toHaveLength(1));
    expect(followed[0]).toContain("storage.example");
    expect(followed[0]).toContain("signed=1");
  });

  it("renames and moves a file without touching the object", async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByLabelText("Rename Statement of work 2026-03.pdf"));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText("File name");
    // The dialog fills its fields once it has opened, so clearing before that
    // types into a box the component is about to overwrite.
    await waitFor(() => expect(field).toHaveValue("Statement of work 2026-03.pdf"));
    await user.clear(field);
    await user.type(field, "Renamed.pdf");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(storedFiles.find((file) => file["id"] === "file-1")?.["name"]).toBe("Renamed.pdf"),
    );
  });

  it("opens the folder the address names", async () => {
    // Which folder is open is a link, not a set of instructions (§69).
    render("/files?folder=folder-2");
    expect(await screen.findByTestId("folder-name")).toHaveTextContent("/contracts/signed");
  });

  it("refuses to delete a folder that is not empty, in place and with the reason", async () => {
    const user = userEvent.setup();
    render("/files?folder=folder-1");

    // Contracts holds a file and a child folder. The service refuses that
    // deliberately — a recursive delete of a tree is a mistake somebody makes
    // once and cannot undo — so the page says so *before* the confirmation
    // rather than discovering it as a 409 afterwards (§76).
    await user.click(await screen.findByTestId("delete-folder"));

    const refused = await screen.findByRole("menuitem", { name: /Only an empty folder can go/ });
    expect(refused).toHaveAttribute("aria-disabled", "true");
  });

  it("offers deleting an empty folder, and asks before doing it", async () => {
    const user = userEvent.setup();
    render("/files?folder=folder-2");

    await user.click(await screen.findByTestId("delete-folder"));
    // A regex: the icon carries an `aria-label` of its own, so the item's
    // accessible name is "delete Delete this folder".
    await user.click(await screen.findByRole("menuitem", { name: /Delete this folder$/ }));

    // Destructive, so it is confirmed — the menu is not the deed. Addressed
    // as the dialog's own title: AntD renders it twice, once for the accessible
    // name and once as the visible heading.
    const confirm = await screen.findByRole("dialog");
    expect(confirm).toHaveTextContent("Delete /contracts/signed?");
    expect(confirm).toHaveTextContent("It is empty, so nothing is lost with it.");
  });

  it("says which permission uploading needs, rather than hiding the control", async () => {
    const { server } = await import("@/test/server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.get("/platform/api/files/tree", () =>
        HttpResponse.json({
          folders: [],
          unfiled: { file_count: 0, total_bytes: 0 },
          store: "object",
          max_upload_bytes: 1024,
          refused_extensions: [],
          can_manage: false,
        }),
      ),
    );
    render();

    // §76: shown and refused, so a reader can see the feature exists.
    expect(await screen.findByTestId("new-folder")).toBeDisabled();
    expect(screen.queryByTestId("dropzone")).not.toBeInTheDocument();
  });
});

describe("acting on several files at once (§43, §75)", () => {
  /**
   * Every list in the product lets somebody tick rows and do one thing to
   * them; this one had per-row buttons only, so deleting twelve files was
   * twelve confirmations and moving them was not possible at all — despite the
   * server having accepted `folder_id` on an update the whole time.
   */
  async function tick(names: string[]): Promise<void> {
    const user = userEvent.setup();
    for (const name of names) {
      const row = screen.getByText(name).closest("tr");
      await user.click(within(row as HTMLElement).getByRole("checkbox"));
    }
  }

  it("shows the bar only once something is ticked", async () => {
    render();
    await screen.findByText("Statement of work 2026-03.pdf");

    // A bar that is always there is a bar nobody reads when it matters.
    expect(screen.queryByTestId("file-bulk")).not.toBeInTheDocument();
    await tick(["Statement of work 2026-03.pdf"]);
    expect(await screen.findByTestId("file-bulk")).toHaveTextContent("1 file selected");
  });

  it("moves the ticked files to a folder, and says what happened", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("Statement of work 2026-03.pdf");

    await tick(["Statement of work 2026-03.pdf", "Floorplan.png"]);
    await user.click(screen.getByTestId("bulk-move"));
    await user.click(await screen.findByRole("combobox", { name: "Move to folder" }));
    await user.click(await screen.findByTitle("/contracts/signed"));

    await waitFor(() => {
      expect(storedFiles.find((file) => file["id"] === "file-1")?.["folder_id"]).toBe("folder-2");
      expect(storedFiles.find((file) => file["id"] === "file-2")?.["folder_id"]).toBe("folder-2");
    });
    // And the selection is spent, rather than staying ticked over rows that
    // are no longer in this folder.
    await waitFor(() => expect(screen.queryByTestId("file-bulk")).not.toBeInTheDocument());
  });

  it("carries the whole selection when one of its rows is dragged to a folder", async () => {
    render();
    await screen.findByText("Statement of work 2026-03.pdf");
    await tick(["Statement of work 2026-03.pdf", "Floorplan.png"]);

    // jsdom fires no drag events of its own, so the transfer is ours — which
    // is the seam under test: what the row *puts in* it and what the folder
    // label *does with it*.
    const transfer = {
      data: {} as Record<string, string>,
      effectAllowed: "",
      setData(key: string, value: string) {
        this.data[key] = value;
      },
      getData(key: string) {
        return this.data[key] ?? "";
      },
    };
    const row = screen.getByText("Floorplan.png").closest("tr") as HTMLElement;
    fireEvent.dragStart(row, { dataTransfer: transfer });
    // Both ids, because the dragged row was part of a selection — "move these
    // two" is one gesture rather than two.
    expect(transfer.getData("text/plain").split(",")).toHaveLength(2);

    const folder = screen.getByTestId("folder-folder-2");
    fireEvent.dragOver(folder, { dataTransfer: transfer });
    fireEvent.drop(folder, { dataTransfer: transfer });

    await waitFor(() =>
      expect(storedFiles.find((file) => file["id"] === "file-2")?.["folder_id"]).toBe("folder-2"),
    );
  });

  it("deletes the ticked files behind one confirmation, not twelve", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("Statement of work 2026-03.pdf");

    await tick(["migration-notes.md", "Floorplan.png"]);
    await user.click(screen.getByTestId("bulk-delete"));
    // One dialog, naming the count — and it says what goes with them.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Delete 2 files?");
    await user.click(within(dialog).getByRole("button", { name: /Delete 2/ }));

    await waitFor(() => {
      expect(storedFiles.find((file) => file["id"] === "file-2")).toBeUndefined();
      expect(storedFiles.find((file) => file["id"] === "file-3")).toBeUndefined();
    });
  });
});
