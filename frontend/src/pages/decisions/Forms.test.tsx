import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render as rtl } from "@testing-library/react";
import { App as AntApp } from "antd";
import { Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FormDesignerPage, { moved, newField } from "@/pages/decisions/FormDesignerPage";
import FormsPage from "@/pages/decisions/FormsPage";
import { PublicFormPage } from "@/pages/decisions/PublicFormPage";
import { publicFormSlug } from "@/pages/decisions/publicEntry";
import { grantDecisions } from "@/test/decisions";
import { decisionCalls, resetDecisions } from "@/test/handlers/decisions";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

// The public page signs in through the application's own adapter; keycloak-js
// itself has nowhere to redirect to under jsdom.
const signIn = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/auth/keycloak", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/auth/keycloak")>()),
  initializeAuth: vi.fn(() => {
    signIn.calls += 1;
    return Promise.resolve();
  }),
}));

function render(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/forms" element={<FormsPage />} />
      <Route path="/admin/forms/:id" element={<FormDesignerPage />} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  resetDecisions();
  grantDecisions();
});

describe("form helpers", () => {
  it("moves items and names new fields uniquely", () => {
    expect(moved([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moved([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    const first = newField("select", []);
    expect(first).toMatchObject({ id: "select1", options: ["Option one", "Option two"] });
    expect(newField("select", [first]).id).toBe("select2");
    expect(newField("rating", []).max).toBe(5);
    expect(publicFormSlug("/f/support")).toBe("support");
    expect(publicFormSlug("/f/")).toBeNull();
  });
});

describe("FormsPage", () => {
  it("lists forms with what they create and how they are doing", async () => {
    render("/admin/forms");
    const row = await screen.findByTestId("form-row");
    expect(row).toHaveTextContent("Customer support request");
    expect(row).toHaveTextContent("Creates tickets");
    expect(row).toHaveTextContent("/f/support");
    expect(screen.getByText(/1 published · 2 answers this week/)).toBeInTheDocument();
  });
});

describe("FormDesignerPage", () => {
  it("adds a field from the palette, edits it in the inspector and saves", async () => {
    render("/admin/forms/form-1");
    await screen.findByTestId("form-canvas");
    await userEvent.click(screen.getByTestId("form-tool-rating"));
    const inspector = await screen.findByTestId("form-inspector");
    const label = within(inspector).getByLabelText("Field label");
    await userEvent.clear(label);
    await userEvent.type(label, "How urgent?");
    await userEvent.click(within(inspector).getByLabelText("Required"));
    await userEvent.click(screen.getByTestId("form-save"));
    await waitFor(() => {
      const call = decisionCalls.find((c) => c.path === "forms/form-1");
      const fields = (call?.body as { fields: { label: string; required: boolean }[] }).fields;
      expect(fields[fields.length - 1]).toMatchObject({ label: "How urgent?", required: true });
    });
  });

  it("drags a palette field onto the canvas, reorders and removes", async () => {
    render("/admin/forms/form-1");
    const canvas = await screen.findByTestId("form-canvas");
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "" };
    fireEvent.dragStart(screen.getByTestId("form-tool-date"), { dataTransfer });
    fireEvent.dragOver(canvas, { dataTransfer });
    fireEvent.drop(canvas, { dataTransfer });
    expect(within(canvas).getAllByTestId("form-field")).toHaveLength(6);
    const fields = within(canvas).getAllByTestId("form-field");
    data.clear();
    fireEvent.dragStart(fields[3]!, { dataTransfer });
    fireEvent.dragOver(fields[0]!, { dataTransfer });
    fireEvent.drop(fields[0]!, { dataTransfer });
    expect(within(canvas).getAllByTestId("form-field")[0]).toHaveTextContent("Area");
    await userEvent.click(within(canvas).getAllByRole("button", { name: /^Move .+ up$/ })[1]!);
    await userEvent.click(within(canvas).getAllByRole("button", { name: /^Remove / })[0]!);
    expect(within(canvas).getAllByTestId("form-field")).toHaveLength(5);
  });

  it("maps a field and sets a condition, and previews the form", async () => {
    render("/admin/forms/form-1");
    const canvas = await screen.findByTestId("form-canvas");
    await userEvent.click(within(canvas).getAllByTestId("form-field")[3]!);
    const inspector = screen.getByTestId("form-inspector");
    await userEvent.click(within(inspector).getByRole("combobox", { name: "Writes to" }));
    await userEvent.click(await screen.findByText("Priority", { selector: ".ant-select-item-option-content" }));
    await userEvent.click(within(inspector).getByRole("combobox", { name: "Depends on" }));
    await userEvent.click(await screen.findByText("Your email", { selector: ".ant-select-item-option-content" }));
    await userEvent.type(within(inspector).getByLabelText("Equals"), "x");
    await userEvent.click(screen.getByText("Preview"));
    expect(await screen.findByTestId("form-submit")).toHaveTextContent("Send request");
  });

  it("creates a new form and publishes it", async () => {
    render("/admin/forms/new");
    await screen.findByTestId("form-canvas");
    await userEvent.click(screen.getByTestId("form-publish"));
    await waitFor(() => expect(decisionCalls.find((c) => c.path === "forms")?.body).toMatchObject({ status: "PUBLISHED", target: "ticket" }));
  });

  it("changes settings", async () => {
    render("/admin/forms/form-1?tab=settings");
    await userEvent.clear(await screen.findByLabelText("Form name"));
    await userEvent.type(screen.getByLabelText("Form name"), "Help desk");
    await userEvent.click(screen.getByText("Signed-in colleagues"));
    await userEvent.click(screen.getByLabelText("Challenge"));
    await userEvent.click(screen.getByRole("button", { name: "Remove priority" }));
    await userEvent.click(screen.getByTestId("form-save"));
    await waitFor(() => expect(decisionCalls.find((c) => c.path === "forms/form-1")?.body).toMatchObject({
      name: "Help desk", settings: { visibility: "INTERNAL", captcha: false, defaults: {} },
    }));
  });

  it("lists submissions with links to their records, and retries a failed one", async () => {
    render("/admin/forms/form-1?tab=submissions");
    const list = await screen.findByTestId("form-submissions");
    expect(within(list).getByRole("link", { name: /TIC-00001/ })).toHaveAttribute("href", "/tickets/ticket-1");
    expect(list).toHaveTextContent("Subject is required.");
    await userEvent.click(within(list).getByText(/SUB-00001/));
    expect(list).toHaveTextContent("a, b");
    await userEvent.click(within(list).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(decisionCalls.some((c) => c.path === "retry/s2")).toBe(true));
    await userEvent.click(screen.getByText("failed"));
  });

  it("says when a form does not exist", async () => {
    render("/admin/forms/nope");
    expect(await screen.findByText(/That form does not exist/)).toBeInTheDocument();
  });
});

describe("PublicFormPage", () => {
  const show = (slug: string) => rtl(<AntApp><PublicFormPage slug={slug} /></AntApp>);

  it("asks the challenge, hides conditional fields, and thanks the person", async () => {
    show("support");
    expect(await screen.findByRole("heading", { name: "Customer support request" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Which area?")).toBeNull();
    await userEvent.type(screen.getByRole("textbox", { name: "Your email" }), "dana@example.com");
    await userEvent.type(screen.getByRole("textbox", { name: "What is wrong?" }), "Invoices are empty");
    await userEvent.click(screen.getByRole("combobox", { name: "Area" }));
    await userEvent.click(await screen.findByText("Other", { selector: ".ant-select-item-option-content" }));
    expect(await screen.findByRole("textbox", { name: "Which area?" })).toBeInTheDocument();
    await userEvent.type(screen.getByTestId("form-captcha"), "1");
    await userEvent.click(screen.getByTestId("form-submit"));
    expect(await screen.findByText(/That answer is not right/)).toBeInTheDocument();
    await userEvent.clear(screen.getByTestId("form-captcha"));
    await userEvent.type(screen.getByTestId("form-captcha"), "7");
    await userEvent.click(screen.getByTestId("form-submit"));
    expect(await screen.findByTestId("public-form-done")).toHaveTextContent("SUB-00003");
    const sent = decisionCalls.filter((c) => c.path === "public-submit").pop()?.body as { answers: Record<string, unknown>; website: string };
    expect(sent.answers).toMatchObject({ email: "dana@example.com", subject: "Invoices are empty", area: "Other" });
    expect(sent.website).toBe("");
    await userEvent.click(screen.getByRole("button", { name: "Send another" }));
  });

  it("offers a way to sign in when the form is for colleagues, rather than a dead end", async () => {
    signIn.calls = 0;
    server.use(
      http.get("/platform/public/forms/:slug", () =>
        HttpResponse.json(
          { error: "unauthorized", message: "Sign in to use this form.", details: { visibility: "INTERNAL" } },
          { status: 401 },
        ),
      ),
    );
    show("it-equipment");
    expect(await screen.findByText(/for colleagues — sign in to Nucleus to answer it/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("public-form-sign-in"));
    await waitFor(() => expect(signIn.calls).toBe(1));
  });

  it("finishes signing in on the way back from the identity provider, then loads the form", async () => {
    signIn.calls = 0;
    window.location.hash = "#state=abc&session_state=x&code=xyz";
    try {
      show("support");
      expect(await screen.findByRole("heading", { name: "Customer support request" })).toBeInTheDocument();
      expect(signIn.calls).toBe(1);
    } finally {
      window.location.hash = "";
    }
  });

  it("says when a form is not there", async () => {
    show("missing");
    expect(await screen.findByText(/does not exist, or is no longer published/)).toBeInTheDocument();
  });
});
