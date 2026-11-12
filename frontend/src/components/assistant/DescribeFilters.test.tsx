import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { filterSuggestion, meWithAi } from "@/test/handlers/assistant";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import { AskData, DescribeFilters, stashPending, takePending } from "./DescribeFilters";

beforeEach(() => sessionStorage.clear());

describe("DescribeFilters", () => {
  it("is absent without the assistant", async () => {
    renderWithProviders(<DescribeFilters resourceType="ticket" currentTree={null} onLoad={vi.fn()} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId("describe-filters")).toBeNull();
  });

  it("loads the compiled tree into the draft and explains what it did", async () => {
    server.use(meWithAi());
    const onLoad = vi.fn();
    renderWithProviders(<DescribeFilters resourceType="ticket" currentTree={null} onLoad={onLoad} />);
    await userEvent.type(await screen.findByTestId("describe-input"), "open tickets{Enter}");
    expect(await screen.findByTestId("describe-result")).toHaveTextContent("Open tickets. 12 matches.");
    expect(screen.getByText(/Ignored “colour”/)).toBeInTheDocument();
    expect(onLoad).toHaveBeenCalledWith(filterSuggestion.tree);
  });

  it("says when it failed, and when it fell back to the words", async () => {
    server.use(meWithAi());
    renderWithProviders(<DescribeFilters resourceType="ticket" currentTree={null} onLoad={vi.fn()} />);
    await userEvent.type(await screen.findByTestId("describe-input"), "fail please");
    await userEvent.click(screen.getByTestId("describe-go"));
    expect(await screen.findByText("The assistant took too long — try again.")).toBeInTheDocument();
  });

  it("picks up a question asked from the toolbar for its dataset only", async () => {
    server.use(meWithAi());
    stashPending({ ...filterSuggestion, source: "fallback", match_count: 1, question: "open ones" });
    expect(takePending("project")).toBeNull();
    const onLoad = vi.fn();
    renderWithProviders(<DescribeFilters resourceType="ticket" currentTree={null} onLoad={onLoad} />);
    expect(await screen.findByDisplayValue("open ones")).toBeInTheDocument();
    expect(screen.getByTestId("describe-result")).toHaveTextContent("1 match.");
    expect(screen.getByText(/Built from the words alone/)).toBeInTheDocument();
    expect(onLoad).toHaveBeenCalled();
    expect(takePending("ticket")).toBeNull();
    sessionStorage.setItem("nucleus.assistant.pendingFilter", "{broken");
    expect(takePending("ticket")).toBeNull();
  });
});

describe("AskData", () => {
  it("compiles a question for any dataset and hands it to the Rules drawer", async () => {
    server.use(meWithAi());
    const onReview = vi.fn();
    renderWithProviders(<AskData onReview={onReview} />);
    await userEvent.click(await screen.findByTestId("ask-data-open"));
    await userEvent.type(await screen.findByTestId("ask-input"), "which tickets are open{Enter}");
    await waitFor(() => expect(onReview).toHaveBeenCalledWith("ticket"));
    expect(takePending("ticket")?.question).toBe("which tickets are open");
  });

  it("shows a failure and is absent without permission", async () => {
    server.use(meWithAi());
    renderWithProviders(<AskData onReview={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("ask-data-open"));
    await userEvent.type(await screen.findByTestId("ask-input"), "fail");
    await userEvent.click(screen.getByTestId("ask-go"));
    expect(await screen.findByText("The assistant took too long — try again.")).toBeInTheDocument();
  });
});
