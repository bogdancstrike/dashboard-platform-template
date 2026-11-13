import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { AssistantChat } from "@/components/assistant/AssistantChat";
import { describeSources } from "@/components/assistant/SourcePicker";
import { resetKnowledge } from "@/test/handlers/knowledge";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/** Data mode's sources (§41, §44): records and/or document collections, like Horizon's Ask. */
beforeEach(() => resetKnowledge());

describe("SourcePicker in the assistant", () => {
  it("chooses records, a collection and one of its files, and sends them with the new conversation", async () => {
    const created: unknown[] = [];
    server.use(
      http.post("/platform/api/assistant/conversations", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        created.push(body);
        return HttpResponse.json({ id: "c-src", title: "New conversation", mode: "data", sources: body["sources"],
                                   message_count: 0, last_message_at: null, created_at: "", updated_at: "", messages: [] }, { status: 201 });
      }),
    );
    renderWithProviders(<AssistantChat conversationId={null} initialMode="data" />);
    const button = await screen.findByTestId("assistant-sources");
    expect(button).toHaveTextContent("Sources: Records");
    await userEvent.click(button);
    const collection = await screen.findByText("Company policies");
    await userEvent.click(collection);
    expect(screen.getByTestId("assistant-sources")).toHaveTextContent("Records · Company policies");

    await userEvent.click(screen.getByText("My records"));
    expect(screen.getByTestId("assistant-sources")).toHaveTextContent("Sources: Company policies");
    // The last source cannot be taken away.
    await userEvent.click(screen.getByText("Company policies"));
    expect(screen.getByTestId("assistant-sources")).toHaveTextContent("Sources: Company policies");

    await userEvent.click(screen.getByRole("button", { name: "Show files of Company policies" }));
    await userEvent.click(await screen.findByText("Onboarding.md"));
    expect(screen.getByTestId("assistant-sources")).toHaveTextContent("Company policies · 1 file");
    expect(screen.getByText("No file ticked means the whole collection.")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Onboarding.md"));
    await userEvent.click(screen.getByRole("button", { name: "Hide files of Company policies" }));

    await userEvent.type(screen.getByTestId("assistant-input"), "What is the hotel limit?{Enter}");
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ mode: "data", sources: { records: false, collections: ["kc-1"], documents: [] } });
  });

  it("updates an existing conversation's sources", async () => {
    const patched: unknown[] = [];
    server.use(
      http.get("/platform/api/assistant/conversations/c-9", () =>
        HttpResponse.json({ id: "c-9", title: "T", mode: "data", sources: { records: true, collections: [], documents: [] },
                            message_count: 0, last_message_at: null, created_at: "", updated_at: "", messages: [] })),
      http.patch("/platform/api/assistant/conversations/c-9", async ({ request }) => {
        patched.push(await request.json());
        return HttpResponse.json({ id: "c-9", title: "T", mode: "data", message_count: 0, last_message_at: null, created_at: "", updated_at: "" });
      }),
    );
    renderWithProviders(<AssistantChat conversationId="c-9" />);
    await userEvent.click(await screen.findByTestId("assistant-sources"));
    await userEvent.click(await screen.findByText("Company policies"));
    await waitFor(() => expect(patched).toEqual([{ sources: { records: true, collections: ["kc-1"], documents: [] } }]));
  });

  it("describes what is chosen", () => {
    expect(describeSources({ records: true, collections: ["a", "b"], documents: ["d"] })).toBe("Records · 2 collections · 1 file");
    expect(describeSources({ records: false, collections: ["a"], documents: [] })).toBe("1 collection");
    expect(describeSources({ records: false, collections: [], documents: [] })).toBe("Nothing");
  });
});
