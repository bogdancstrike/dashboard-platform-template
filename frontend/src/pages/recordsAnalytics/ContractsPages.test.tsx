import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { ra, resetRecordsAnalytics } from "@/test/handlers/recordsAnalytics";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";
import { currentUser as profile } from "@/test/handlers";

import ContractDetailPage from "./ContractDetailPage";
import ContractsPage from "./ContractsPage";

function page(route = "/contracts") {
  return renderWithProviders(
    <Routes>
      <Route path="/contracts" element={<ContractsPage />} />
      <Route path="/contracts/:id" element={<ContractDetailPage />} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  resetRecordsAnalytics();
  // The fixture administrator, plus the permission this page writes with.
  server.use(http.get("/platform/api/me", () => HttpResponse.json({ ...profile, permissions: [...profile.permissions, "contracts.manage", "files.manage"] })));
});

describe("ContractsPage", () => {
  it("shows the pipeline with totals and the at-risk flag", async () => {
    page();
    const board = await screen.findByTestId("contract-board");
    expect(within(board).getByLabelText(/Upcoming: 1 contracts/)).toBeInTheDocument();
    expect(screen.getByTestId("contracts-pipeline")).toHaveTextContent("€240k");
    const risky = screen.getByTestId("contract-card-CTR-00002");
    expect(within(risky).getByTestId("at-risk")).toBeInTheDocument();
  });

  it("moves a card to another stage with the keyboard", async () => {
    page();
    const card = await screen.findByTestId("contract-card-CTR-00001");
    card.focus();
    fireEvent.keyDown(card, { key: " " });
    fireEvent.keyDown(card, { key: "ArrowRight" });
    fireEvent.keyDown(card, { key: " " });
    await waitFor(() => expect(ra.contracts.find((c) => c.id === "ctr-1")!.stage).toBe("NEGOTIATION"));
    expect(await screen.findByText(/CTR-00001 → In negotiation/)).toBeInTheDocument();
  });

  it("puts a refused move back and says why", async () => {
    page();
    const card = await screen.findByTestId("contract-card-CTR-00003");
    card.focus();
    fireEvent.keyDown(card, { key: " " });
    fireEvent.keyDown(card, { key: "ArrowRight" });
    fireEvent.keyDown(card, { key: " " });
    expect(await screen.findByText(/You do not have permission to move contracts/)).toBeInTheDocument();
    expect(ra.contracts.find((c) => c.id === "ctr-3")!.stage).toBe("RENEWED");
  });

  it("switches to the list, the forecast and the calendar", async () => {
    page("/contracts?view=list");
    expect(await screen.findByText("CTR-00002")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Forecast"));
    const forecast = await screen.findByTestId("contract-forecast");
    expect(within(forecast).getByText(/Q3 2026 · now/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Calendar"));
    const calendar = await screen.findByTestId("contract-calendar");
    expect(await within(calendar).findByText("Notice · Brightpath Works")).toBeInTheDocument();
    fireEvent.click(within(calendar).getByLabelText("Next month"));
    fireEvent.click(within(calendar).getByLabelText("Previous month"));
    fireEvent.click(within(calendar).getByText("Today"));
    fireEvent.click(within(calendar).getAllByText("Acme Logistics")[0]!);
  });

  it("filters to at-risk and searches", async () => {
    page();
    await screen.findByTestId("contract-board");
    fireEvent.click(screen.getByText("At risk only"));
    expect(screen.getByText("At risk only")).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Search contracts"), { target: { value: "Acme" } });
    fireEvent.keyDown(screen.getByLabelText("Search contracts"), { key: "Enter" });
  });

  it("opens the new-contract form and asks for what is missing", async () => {
    page();
    fireEvent.click(await screen.findByTestId("contract-new"));
    fireEvent.click(await screen.findByTestId("contract-save"));
    expect(await screen.findByText("A contract needs a title")).toBeInTheDocument();
    expect(screen.getByText("Choose the customer")).toBeInTheDocument();
  });
});

describe("ContractDetailPage", () => {
  it("shows terms, health and moves the stage from the stepper", async () => {
    page("/contracts/ctr-2");
    expect(await screen.findByTestId("contract-detail")).toBeInTheDocument();
    expect(screen.getByText("€120k", { selector: "b" })).toBeInTheDocument();
    expect(screen.getByText(/flagged at risk on the pipeline/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Committed" }));
    await waitFor(() => expect(ra.contracts.find((c) => c.id === "ctr-2")!.stage).toBe("COMMITTED"));
  });

  it("lists files and versions in their tabs", async () => {
    page("/contracts/ctr-1?tab=files");
    expect(await screen.findByText("signed.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByTestId("version-history")).toBeInTheDocument();
  });

  it("opens the edit form filled in, and deletes after a confirmation", async () => {
    page("/contracts/ctr-1");
    fireEvent.click(await screen.findByTestId("contract-edit"));
    expect(await screen.findByDisplayValue("CTR-00001 subscription")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("contract-save"));
    await waitFor(() => expect(screen.getByText(/CTR-00001 saved/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete", hidden: false }, { timeout: 2000 }).then(() => screen.getAllByRole("button", { name: "Delete" }).at(-1)!));
    await waitFor(() => expect(ra.contracts.find((c) => c.id === "ctr-1")).toBeUndefined());
  });

  it("says when the contract does not exist", async () => {
    page("/contracts/nope");
    expect(await screen.findByText("No contract at this address")).toBeInTheDocument();
  });
});
