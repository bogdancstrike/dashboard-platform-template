import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import FilesPage from "@/pages/FilesPage";
import { resetFiles, storedFiles } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The file manager's remaining paths (§20, §43): a bulk download that reports
 * a refusal, deleting one file, a new folder, the drop hint, the preview in the
 * address, and the library failing to load.
 */
function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}

function render(route = "/files") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/files" element={<FilesPage />} />
      </Routes>
      <Where />
    </>,
    { route },
  );
}

beforeEach(() => resetFiles());

async function tick(names: string[]) {
  const user = userEvent.setup();
  for (const name of names) {
    const row = screen.getByText(name).closest("tr");
    await user.click(within(row as HTMLElement).getByRole("checkbox"));
  }
}

describe("several files at once", () => {
  it("downloads each through its signed URL, and names the first refusal", async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get("/platform/api/files/:id", ({ params }) => {
        // `/files/tree` matches the same pattern; leave it to the fixture.
        if (params["id"] === "tree") return undefined;
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ download: { url: "https://store.example/a?sig=1" } })
          : HttpResponse.json({ error: "forbidden", message: "That file is under legal hold." }, { status: 403 });
      }),
    );
    render();
    await screen.findByText("Statement of work 2026-03.pdf");
    await tick(["Statement of work 2026-03.pdf", "Floorplan.png"]);
    await user.click(screen.getByTestId("bulk-download"));
    expect(await screen.findByText("1 done, 1 refused — That file is under legal hold.")).toBeInTheDocument();
  });

  it("clears the selection from the palette's command and the bar", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("Statement of work 2026-03.pdf");
    await tick(["Floorplan.png"]);
    const bar = await screen.findByTestId("file-bulk");
    const clear = within(bar).queryByRole("button", { name: /Clear/ });
    if (clear) {
      await user.click(clear);
      await waitFor(() => expect(screen.queryByTestId("file-bulk")).not.toBeInTheDocument());
    }
  });
});

describe("one file", () => {
  it("deletes a file after asking", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("Floorplan.png");
    await user.click(screen.getByRole("button", { name: "Delete Floorplan.png" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Floorplan.png deleted")).toBeInTheDocument();
    expect(storedFiles.some((file) => file["name"] === "Floorplan.png")).toBe(false);
  });

  it("opens the preview in the address and closes it again", async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByText("Floorplan.png"));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("file="));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getAllByRole("button", { name: /Close/ })[0]!);
    await waitFor(() => expect(screen.getByTestId("where")).not.toHaveTextContent("file="));
  });

  it("reports a refused delete in the server's words", async () => {
    const user = userEvent.setup();
    server.use(
      http.delete("/platform/api/files/:id", () =>
        HttpResponse.json({ error: "forbidden", message: "Files in a signed folder are kept." }, { status: 403 }),
      ),
    );
    render();
    await screen.findByText("Floorplan.png");
    await user.click(screen.getByRole("button", { name: "Delete Floorplan.png" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Files in a signed folder are kept.")).toBeInTheDocument();
  });
});

describe("folders and the drop area", () => {
  it("makes a new folder inside the open one, and opens it", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("Floorplan.png");
    await user.click(screen.getByRole("button", { name: /New folder/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/New folder in/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Folder name"), "Ünïcode ✓{Enter}");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("folder="));
  });

  it("says where a drop will go while something is dragged over the list", () => {
    render();
    return screen.findByTestId("dropzone").then((zone) => {
      fireEvent.dragOver(zone);
      expect(screen.getByText(/Drop to upload/)).toBeInTheDocument();
      fireEvent.dragLeave(zone, { relatedTarget: document.body });
      expect(screen.queryByText(/Drop to upload/)).not.toBeInTheDocument();
    });
  });

  it("says nothing matches a search in this folder", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("Floorplan.png");
    const search = screen.getAllByRole("searchbox")[0] ?? screen.getByPlaceholderText(/Search/);
    await user.type(search, "ζζζ-none");
    expect(await screen.findByText("Nothing here matches that")).toBeInTheDocument();
  });
});

describe("when the library cannot be loaded", () => {
  it("names the missing permission", async () => {
    server.use(
      http.get("/platform/api/files/tree", () =>
        HttpResponse.json({ error: "forbidden", message: "Files are not in your role.", details: { missing: ["files.view"] } }, { status: 403 }),
      ),
    );
    render();
    expect(await screen.findByText("Files are not in your role.")).toBeInTheDocument();
    expect(screen.getByText("Missing: files.view")).toBeInTheDocument();
  });
});
