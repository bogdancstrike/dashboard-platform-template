import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import { Grid } from "antd";

import DocumentsPage from "@/pages/DocumentsPage";
import { CommandProvider } from "@/commands/CommandContext";
import { failureText, isReading } from "@/api/knowledge";
import { knowledgeFlags, knowledgeState, resetKnowledge } from "@/test/handlers/knowledge";
import { resetFiles } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * Ask your documents (§44): a collection, its files and their reading, and a
 * conversation whose answers carry citations that open the cited passage.
 */
function render(route = "/ai/documents") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/ai/documents" element={<DocumentsPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

beforeEach(() => {
  resetKnowledge();
  resetFiles();
  knowledgeFlags.askStatus = 200;
});
afterEach(() => vi.restoreAllMocks());

describe("DocumentsPage", () => {
  it("lists the collections and opens the first one on its conversation", async () => {
    vi.spyOn(Grid, "useBreakpoint").mockReturnValue({ md: true, lg: true, xl: true });
    render();
    expect(await screen.findByTestId("collection-title")).toHaveTextContent("Company policies");
    const rows = await screen.findAllByTestId("collection-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText(/2 collections · 3 documents · 3 pages read/)).toBeInTheDocument();
    expect(screen.getByTestId("ask-panel")).toBeInTheDocument();
  });

  it("filters the collection list by name", async () => {
    vi.spyOn(Grid, "useBreakpoint").mockReturnValue({ md: true, lg: true, xl: true });
    render();
    await screen.findAllByTestId("collection-row");
    await userEvent.type(screen.getByPlaceholderText("Find a collection"), "support");
    expect(screen.getAllByTestId("collection-row")).toHaveLength(1);
    await userEvent.clear(screen.getByPlaceholderText("Find a collection"));
    await userEvent.type(screen.getByPlaceholderText("Find a collection"), "zzz");
    expect(await screen.findByText("No collection matches")).toBeInTheDocument();
  });

  it("picks a collection from a menu on a phone", async () => {
    render();
    expect(await screen.findByTestId("collection-title")).toHaveTextContent("Company policies");
    fireEvent.mouseDown(within(screen.getByTestId("collection-picker")).getByRole("combobox"));
    await userEvent.click(await screen.findByTitle("Support knowledge base"));
    await waitFor(() => expect(screen.getByTestId("collection-title")).toHaveTextContent("Support knowledge base"));
  });

  it("shows a seeded conversation with numbered citations and opens the cited passage", async () => {
    render("/ai/documents?collection=kc-1&thread=kt-1");
    const answer = await screen.findByTestId("answer");
    expect(within(answer).getByText("180 EUR")).toBeInTheDocument();
    expect(within(answer).getAllByTestId("answer-cite")).toHaveLength(2);
    const sources = within(answer).getAllByTestId("answer-source");
    expect(sources[0]).toHaveTextContent("Employee Handbook.pdf");
    expect(sources[0]).toHaveTextContent("p. 2");

    // The Markdown citation (a text file): the preview marks the passage.
    server.use(
      http.get("/platform/api/files/:id", () =>
        HttpResponse.json({
          file: {
            id: "file-kd-2", name: "Onboarding.md", extension: "md", mime_type: "text/markdown", kind: "DOCUMENT",
            size_bytes: 80, checksum: null, folder_id: null, status: "READY", version: 1, download_count: 0,
            preview_text: null, owner: "Ada", created_at: null, last_accessed_at: null,
          },
          download: { url: "https://storage.example/onboarding.md", method: "GET", expires_in: 900 },
        }),
      ),
      http.get("https://storage.example/onboarding.md", () =>
        HttpResponse.text("# Onboarding\n\nWelcome.\n\nExpense claims must be filed within 30 days.\n"),
      ),
    );
    fireEvent.click(sources[1]!);
    expect(await screen.findByTestId("citation-text-mark")).toHaveTextContent(
      "Expense claims must be filed within 30 days.",
    );
  });

  it("asks a question and adds the answer to a new conversation", async () => {
    render("/ai/documents?collection=kc-1");
    expect(await screen.findByText("Ask anything about Company policies")).toBeInTheDocument();
    expect(await screen.findByText("What do the documents say about remote work?")).toBeInTheDocument();
    await userEvent.type(screen.getByTestId("ask-input"), "What about hotels?");
    await userEvent.click(screen.getByTestId("ask-send"));
    const answers = await screen.findAllByTestId("answer");
    expect(answers.at(-1)).toHaveTextContent("What about hotels?");
    expect(knowledgeState.answers.at(-1)?.question).toBe("What about hotels?");
  });

  it("asks a suggested question with one press", async () => {
    render("/ai/documents?collection=kc-1");
    await userEvent.click(await screen.findByText("What do the documents say about remote work?"));
    expect((await screen.findAllByTestId("answer")).at(-1)).toHaveTextContent("remote work");
  });

  it("says plainly when the model is unavailable, and keeps the question to retry", async () => {
    knowledgeFlags.askStatus = 503;
    render("/ai/documents?collection=kc-1");
    await userEvent.type(await screen.findByTestId("ask-input"), "Is anyone there?");
    await userEvent.click(screen.getByTestId("ask-send"));
    const failure = await screen.findByTestId("ask-failure");
    expect(failure).toHaveTextContent("not available right now");
    knowledgeFlags.askStatus = 200;
    await userEvent.click(within(failure).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByTestId("ask-failure")).not.toBeInTheDocument());
    expect(await screen.findAllByTestId("answer")).not.toHaveLength(0);
  });

  it("switches conversations, starts a new one and forgets one", async () => {
    render("/ai/documents?collection=kc-1");
    await userEvent.click(await screen.findByTestId("ask-threads"));
    await userEvent.click(await screen.findByText("How much can I spend on a hotel?"));
    expect(await screen.findByTestId("answer")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Forget this conversation" }));
    await waitFor(() => expect(knowledgeState.answers).toHaveLength(0));
    expect(await screen.findByText("Ask anything about Company policies")).toBeInTheDocument();
  });

  it("shows each document's reading, with the reason a failed one failed, and reprocesses it", async () => {
    render("/ai/documents?collection=kc-1&tab=documents");
    const rows = await screen.findAllByTestId("document-row");
    expect(rows).toHaveLength(3);
    expect(screen.getByTestId("document-error")).toHaveTextContent("converter is not available right now");
    await userEvent.click(screen.getByRole("button", { name: "Reprocess Scan.pdf" }));
    await waitFor(() =>
      expect(knowledgeState.collections[0]!.documents.find((d) => d.id === "kd-3")?.status).toBe("QUEUED"),
    );
  });

  it("removes a document from the collection", async () => {
    render("/ai/documents?collection=kc-1&tab=documents");
    await screen.findAllByTestId("document-row");
    await userEvent.click(screen.getByRole("button", { name: "Remove Onboarding.md" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(knowledgeState.collections[0]!.documents).toHaveLength(2));
  });

  it("uploads dropped files to the collection's folder, then adds them", async () => {
    const sent: string[] = [];
    class FakeXhr {
      status = 200;
      upload = { addEventListener: () => {} };
      private handlers: Record<string, (() => void)[]> = {};
      open(_method: string, url: string) {
        sent.push(url);
      }
      setRequestHeader() {}
      addEventListener(kind: string, handler: () => void) {
        this.handlers[kind] = [...(this.handlers[kind] ?? []), handler];
      }
      send() {
        for (const handler of this.handlers["load"] ?? []) handler();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    render("/ai/documents?collection=kc-1&tab=documents");
    await screen.findAllByTestId("document-row");
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const pdf = new File(["%PDF"], "policy.pdf", { type: "application/pdf" });
    const zip = new File(["PK"], "archive.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [pdf, zip] } });
    await waitFor(() => expect(knowledgeState.collections[0]!.documents).toHaveLength(4));
    expect(sent).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("creates a collection and lands on its documents", async () => {
    render();
    await userEvent.click(await screen.findByTestId("collection-new"));
    const modal = await screen.findByRole("dialog");
    await userEvent.type(within(modal).getByTestId("collection-name"), "Contracts");
    await userEvent.click(within(modal).getByText("Everyone"));
    await userEvent.click(within(modal).getByRole("button", { name: "Colour #7C3AED" }));
    await userEvent.click(within(modal).getByRole("button", { name: "Create collection" }));
    expect(await screen.findByTestId("documents-panel")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("collection-title")).toHaveTextContent("Contracts"));
    expect(knowledgeState.collections.at(-1)?.scope).toBe("PUBLIC");
  });

  it("edits a collection's audience to chosen people", async () => {
    render("/ai/documents?collection=kc-1");
    await userEvent.click(await screen.findByTestId("collection-edit"));
    const modal = await screen.findByRole("dialog");
    await userEvent.click(within(modal).getByText("People I choose"));
    expect(within(modal).getByText(/They can ask questions/)).toBeInTheDocument();
    await userEvent.click(within(modal).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(knowledgeState.collections[0]!.scope).toBe("SHARED"));
  });

  it("removes a collection", async () => {
    render("/ai/documents?collection=kc-1");
    await screen.findByTestId("collection-title");
    await userEvent.click(screen.getByRole("button", { name: "Remove collection" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(knowledgeState.collections).toHaveLength(1));
  });

  it("offers nothing to ask a collection with no documents, and no edit to a reader", async () => {
    render("/ai/documents?collection=kc-2");
    expect(await screen.findByText("Nothing to ask yet")).toBeInTheDocument();
    expect(screen.queryByTestId("collection-edit")).not.toBeInTheDocument();
    expect(screen.getByTestId("ask-input")).toBeDisabled();
  });
});

describe("knowledge helpers", () => {
  it("knows when a document is still being read", () => {
    expect(isReading({ status: "PARSING", stalled: false })).toBe(true);
    expect(isReading({ status: "PARSING", stalled: true })).toBe(false);
    expect(isReading({ status: "READY", stalled: false })).toBe(false);
  });

  it("explains failures in plain words", () => {
    expect(failureText("FILE_ENCRYPTED", null)).toMatch(/encrypted/);
    expect(failureText("SOMETHING", "raw")).toBe("raw");
    expect(failureText(null, null)).toMatch(/could not be read/);
  });
});
