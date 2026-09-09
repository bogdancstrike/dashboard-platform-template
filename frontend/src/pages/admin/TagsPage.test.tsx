import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import { Route, Routes } from "react-router-dom";

import TagsPage, { summarise } from "@/pages/admin/TagsPage";
import { TagPicker } from "@/components/records/TagPicker";
import type { TagVocabulary } from "@/api/tags";
import { CommandProvider } from "@/commands/CommandContext";
import { currentUser, tagVocabulary } from "@/test/handlers";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * The tag vocabulary and the picker that applies it (§37).
 *
 * The claims:
 *
 * **A usage count is a link, and a tag on nothing says so.** The unused rows
 * are what somebody came to the page to find, and a count nobody can open is a
 * count nobody can act on (§44).
 *
 * **A system tag's name is not editable and it cannot be removed.** Other
 * things quote it by name.
 *
 * **Deleting says how many records it comes off.** "Remove urgent" and "remove
 * urgent from nine records" are different decisions.
 *
 * **The picker sends the whole set and refuses free text.** Add-one and
 * remove-one calls interleave; a typo typed into a shared vocabulary is a
 * permanent member of it.
 */

function renderManager(route = "/admin/tags") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/admin/tags" element={<TagsPage />} />
        <Route path="/tasks" element={<div>the task board</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

function renderPicker() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/"
        element={<TagPicker resourceType="task" recordId="task-1" listPath="/tasks" />}
      />
      <Route path="/tasks" element={<div>the task board</div>} />
      <Route path="/admin/tags" element={<div>the tag manager</div>} />
    </Routes>,
    { route: "/" },
  );
}

describe("what the page says about the vocabulary", () => {
  it("leads with the tags on nothing, because those are the ones to prune", () => {
    expect(
      summarise({ total: 20, items: [{ usage_count: 0 }, { usage_count: 3 }] } as TagVocabulary),
    ).toBe("20 tags · 1 on nothing");
  });

  it("says nothing extra when every tag is used", () => {
    expect(
      summarise({ total: 2, items: [{ usage_count: 1 }, { usage_count: 3 }] } as TagVocabulary),
    ).toBe("2 tags");
  });
});

describe("the manager", () => {
  it("opens the records a tag is on", async () => {
    const user = userEvent.setup();
    renderManager();
    const link = await screen.findByTestId("tag-usage-urgent");
    // The count *is* the link, through the list's own `tags__contains` filter.
    expect(link).toHaveAttribute("href", "/tasks?f.tags__contains=urgent");

    await user.click(link);
    expect(await screen.findByText("the task board")).toBeInTheDocument();
  });

  it("says when a tag is on nothing rather than showing a zero", async () => {
    renderManager();
    const table = await screen.findByTestId("tags-table");
    const row = within(table).getByText("compliance").closest("tr")!;
    expect(within(row).getByText("nothing")).toBeInTheDocument();
  });

  it("marks a system tag and refuses to remove it", async () => {
    renderManager();
    await screen.findByTestId("tags-table");
    // Automations, saved searches and reports quote it by name.
    expect(screen.getByText("system")).toBeInTheDocument();
    expect(screen.getByTestId("tag-remove-urgent")).toBeDisabled();
    expect(screen.getByTestId("tag-remove-compliance")).toBeEnabled();
  });

  it("cannot rename a system tag from the form either", async () => {
    const user = userEvent.setup();
    renderManager();
    await screen.findByTestId("tags-table");

    await user.click(screen.getByRole("button", { name: "Edit urgent" }));
    // Disabled in the form as well as refused by the server: a field that
    // takes a value and then loses it is worse than one that never offered.
    expect(await screen.findByTestId("tag-name")).toBeDisabled();
    expect(screen.getByText(/cannot be renamed/)).toBeInTheDocument();
  });

  it("says how many records a delete comes off before it happens", async () => {
    const user = userEvent.setup();
    renderManager();
    await screen.findByTestId("tags-table");

    await user.click(screen.getByTestId("tag-remove-documentation"));
    // The consequence in the question.
    expect(await screen.findByText(/It comes off 8 records/)).toBeInTheDocument();
  });

  it("narrows to one category through the address", async () => {
    renderManager("/admin/tags?category=GOVERNANCE");
    const table = await screen.findByTestId("tags-table");
    expect(within(table).getByText("compliance")).toBeInTheDocument();
    expect(within(table).queryByText("urgent")).not.toBeInTheDocument();
  });

  it("names the permission a reader is missing rather than hiding the page", async () => {
    server.use(
      http.get("/platform/tags", () =>
        HttpResponse.json({
          items: tagVocabulary,
          total: tagVocabulary.length,
          categories: [],
          can_manage: false,
          limit_per_record: 12,
          taggable: ["task"],
        }),
      ),
    );
    renderManager();
    // Worth opening to find out what the tags mean, and honest about the rest.
    expect(await screen.findByTestId("tags-readonly")).toHaveTextContent("tags.manage");
    expect(screen.getByTestId("tag-new")).toBeDisabled();
    expect(screen.queryByTestId("tag-remove-compliance")).not.toBeInTheDocument();
  });
});

describe("the picker", () => {
  it("shows the record's tags, each linking to everything else carrying it", async () => {
    renderPicker();
    // Waited for the *content*, not the container: the picker's own element is
    // there while the request is in flight, so finding it proves nothing.
    const tags = await screen.findByTestId("record-tags");
    expect(await within(tags).findByRole("link", { name: /urgent/ })).toHaveAttribute(
      "href",
      "/tasks?f.tags__contains=urgent",
    );
  });

  it("sends the whole set, so a tag is removed by omission", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(await screen.findByTestId("record-tags-edit"));
    // The combobox, not the wrapper the test id sits on: AntD puts the id on
    // the outer div and clicking that does not open the menu.
    await user.click(await screen.findByRole("combobox", { name: "Tags" }));
    // The option by its own class, because the label carries the usage count
    // too ("documentation · 8") and an exact match finds nothing.
    await user.click(
      await screen.findByText(/documentation/, { selector: ".ant-select-item-option-content" }),
    );
    await user.click(screen.getByTestId("record-tags-save"));

    // The fixture answers with what it was *asked for*, so this is the set the
    // picker sent rather than a constant.
    await waitFor(() =>
      expect(screen.getByTestId("record-tags")).toHaveTextContent("documentation"),
    );
    expect(screen.getByTestId("record-tags")).toHaveTextContent("urgent");
  });

  it("points at the manager rather than accepting a new name", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(await screen.findByTestId("record-tags-edit"));

    // A typo typed into a shared vocabulary is a permanent member of it.
    expect(await screen.findByText(/Only tags in the vocabulary/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage them" })).toHaveAttribute(
      "href",
      "/admin/tags",
    );
  });

  it("shows a reader who may not edit the chips and no control", async () => {
    server.use(
      http.get("/platform/api/records/:resourceType/:recordId/tags", () =>
        HttpResponse.json({
          resource_type: "task",
          resource_id: "task-1",
          items: [tagVocabulary[0]],
          can_apply: false,
          limit: 12,
        }),
      ),
    );
    renderPicker();
    // The chips, waited for — then the *absence* of the control, which is
    // only meaningful once the answer has arrived.
    expect(await screen.findByText("urgent")).toBeInTheDocument();
    // A row of chips is the useful thing; a greyed-out select beside it says
    // "you cannot" about something nobody asked to do.
    expect(screen.queryByTestId("record-tags-edit")).not.toBeInTheDocument();
  });

  it("says so plainly when a record has no tags", async () => {
    server.use(
      http.get("/platform/api/records/:resourceType/:recordId/tags", () =>
        HttpResponse.json({
          resource_type: "task", resource_id: "task-1", items: [],
          can_apply: currentUser.permissions.includes("records.update"), limit: 12,
        }),
      ),
    );
    renderPicker();
    expect(await screen.findByText("No tags")).toBeInTheDocument();
    expect(screen.getByTestId("record-tags-edit")).toHaveTextContent("Add tags");
  });
});
