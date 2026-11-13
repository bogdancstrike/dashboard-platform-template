import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import OnboardingPage from "@/pages/OnboardingPage";
import { OnboardingCard } from "@/components/onboarding/OnboardingCard";
import { EmptyGuide } from "@/components/onboarding/EmptyGuide";
import { EmptyState } from "@/components/EmptyState";
import { renderWithProviders } from "@/test/render";
import { onboardingState, resetOnboarding } from "@/test/handlers/onboarding";

afterEach(() => resetOnboarding());

function renderPage() {
  return renderWithProviders(
    <Routes><Route path="/onboarding" element={<OnboardingPage />} /></Routes>,
    { route: "/onboarding" },
  );
}

describe("OnboardingPage", () => {
  it("lists the role's steps with their states and progress", async () => {
    renderPage();
    const steps = await screen.findByTestId("onboarding-steps");
    expect(within(steps).getByTestId("step-profile")).toHaveTextContent("Done — we noticed");
    expect(within(steps).getByTestId("step-integration")).toHaveTextContent("Skipped");
    expect(within(steps).getByTestId("step-invite")).toHaveTextContent("Ticks itself off");
    expect(steps).toHaveTextContent("2 of 4");
  });

  it("marks a step done, skips one and undoes it", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("done-tour"));
    await waitFor(() => expect(screen.getByTestId("step-tour")).toHaveTextContent("Marked done"));
    fireEvent.click(screen.getByTestId("undo-tour"));
    await waitFor(() => expect(screen.getByTestId("done-tour")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("skip-invite"));
    await waitFor(() => expect(onboardingState.checklist.steps[1]!.state).toBe("skipped"));
  });

  it("hides the Home card and brings it back", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("hide-card"));
    expect(await screen.findByTestId("restore-card")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("restore-card"));
    expect(await screen.findByTestId("hide-card")).toBeInTheDocument();
  });

  it("loads sample data for an area and removes it after confirming", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("load-sample-customers"));
    expect(await screen.findByText("Loaded 8 sample records")).toBeInTheDocument();
    expect(within(screen.getByTestId("sample-customers")).getByText("8 sample")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("remove-sample-tasks"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByTestId("load-sample-tasks")).toBeInTheDocument());
  });

  it("offers no sample data to somebody who is not an administrator", async () => {
    resetOnboarding({ can_load_samples: false, role: "OPERATOR" });
    renderPage();
    await screen.findByTestId("onboarding-steps");
    expect(screen.queryByTestId("sample-data")).not.toBeInTheDocument();
    expect(screen.getByText(/an operator/)).toBeInTheDocument();
  });
});

describe("OnboardingCard", () => {
  it("shows the next steps on Home and goes away when dismissed", async () => {
    renderWithProviders(<OnboardingCard />);
    const card = await screen.findByTestId("onboarding-card");
    expect(within(card).getByTestId("card-step-invite")).toBeInTheDocument();
    expect(within(card).queryByTestId("card-step-profile")).not.toBeInTheDocument();
    fireEvent.click(within(card).getByTestId("dismiss-onboarding"));
    await waitFor(() => expect(screen.queryByTestId("onboarding-card")).not.toBeInTheDocument());
  });

  it("is not shown once everything is done", async () => {
    resetOnboarding({ progress: { done: 4, total: 4, percent: 100 } });
    const { container } = renderWithProviders(<OnboardingCard />);
    await waitFor(() => expect(container.querySelector(".nx-ob-card")).toBeNull());
  });
});

describe("EmptyGuide", () => {
  it("explains an empty page and loads its sample data", async () => {
    renderWithProviders(<EmptyState title="No customers yet" guide="customer" />);
    const guide = screen.getByTestId("empty-guide-customer");
    expect(guide).toHaveTextContent("accounts you serve");
    fireEvent.click(await within(guide).findByTestId("load-sample"));
    expect(await screen.findByText(/Loaded 8 sample records/)).toBeInTheDocument();
  });

  it("says why sample data could not be loaded, and renders nothing for an unknown area", async () => {
    renderWithProviders(<><EmptyGuide area="nothing" /><EmptyGuide area="workflow" /></>);
    expect(screen.queryByTestId("empty-guide-nothing")).not.toBeInTheDocument();
    expect(screen.getByText("Go there")).toBeInTheDocument();
    expect(screen.queryByTestId("load-sample")).not.toBeInTheDocument();
  });

  it("is left out of a compact empty state", () => {
    renderWithProviders(<EmptyState compact title="Nothing" guide="task" />);
    expect(screen.queryByTestId("empty-guide-task")).not.toBeInTheDocument();
  });
});
