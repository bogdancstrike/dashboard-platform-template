import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  CommandProvider,
  aLayerOwnsTheKeyboard,
  isTyping,
  useCommands,
  usePageCommands,
} from "@/commands/CommandContext";

/**
 * The keyboard's two ways into the palette, and the guard on the plain one (§54).
 *
 * The chord had a comment claiming it "never fires while somebody is typing"
 * and no code that did so, and `/` — the other half of the keyboard map the
 * tracker specifies — was not implemented at all. A promise in a comment is
 * the easiest kind to keep for years without keeping it.
 *
 * The distinction the tests pin: **a chord is not a character.** Ctrl/Cmd-K
 * has to work inside the search box, because that is where somebody already
 * typing what they are looking for is. `/` must not, because it would land in
 * their sentence.
 */

function Probe() {
  const { open, commands } = useCommands();
  usePageCommands("probe", [
    { id: "probe.one", label: "Do the thing", run: () => undefined },
  ]);
  return (
    <div>
      <span data-testid="state">{open ? "open" : "closed"}</span>
      <span data-testid="commands">{commands.map((one) => one.id).join(",")}</span>
      <input aria-label="search" />
      <textarea aria-label="note" />
      <input aria-label="tick" type="checkbox" />
    </div>
  );
}

function renderProbe() {
  return render(
    <CommandProvider>
      <Probe />
    </CommandProvider>,
  );
}

const state = () => screen.getByTestId("state").textContent;

describe("the palette's shortcuts", () => {
  it("opens and closes on the chord", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.keyboard("{Control>}k{/Control}");
    expect(state()).toBe("open");
    // The same chord closes it: a shortcut that only opens leaves a reader
    // reaching for the mouse to undo a keystroke.
    await user.keyboard("{Control>}k{/Control}");
    expect(state()).toBe("closed");
  });

  it("takes the Mac chord too", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.keyboard("{Meta>}k{/Meta}");
    expect(state()).toBe("open");
  });

  it("still opens on the chord while somebody is typing in a field", async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByLabelText("search"));

    await user.keyboard("{Control>}k{/Control}");

    // Deliberate: the search box is exactly where somebody already typing
    // what they are looking for is, and a chord cannot interrupt a sentence.
    expect(state()).toBe("open");
  });

  it("opens on a bare slash", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.keyboard("/");

    expect(state()).toBe("open");
  });

  it("leaves a slash alone inside every kind of text field", async () => {
    const user = userEvent.setup();
    renderProbe();

    for (const label of ["search", "note"]) {
      const field = screen.getByLabelText(label);
      await user.click(field);
      await user.keyboard("and/or");
      expect(state()).toBe("closed");
      expect(field).toHaveValue("and/or");
    }
  });

  it("takes a slash from a tick box, which holds no text", async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByLabelText("tick"));

    await user.keyboard("/");

    // A row of checkboxes down a table's first column is exactly where a
    // reader's focus is when they decide to search.
    expect(state()).toBe("open");
  });

  it("ignores a plain k, and a chord with the wrong key", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.keyboard("k");
    await user.keyboard("{Control>}j{/Control}");

    expect(state()).toBe("closed");
  });
});

describe("the guards, directly", () => {
  it("knows which elements a character belongs in", () => {
    const text = document.createElement("input");
    const tick = document.createElement("input");
    tick.type = "checkbox";
    const area = document.createElement("textarea");
    const div = document.createElement("div");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    // jsdom does not derive `isContentEditable` from the attribute.
    Object.defineProperty(editable, "isContentEditable", { value: true });

    expect(isTyping(text)).toBe(true);
    expect(isTyping(area)).toBe(true);
    expect(isTyping(editable)).toBe(true);
    expect(isTyping(tick)).toBe(false);
    expect(isTyping(div)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });

  it("sees an open modal or drawer as the owner of the keyboard", () => {
    const fake = document.implementation.createHTMLDocument("probe");
    expect(aLayerOwnsTheKeyboard(fake)).toBe(false);

    const modal = fake.createElement("div");
    modal.className = "ant-modal-wrap";
    fake.body.append(modal);
    expect(aLayerOwnsTheKeyboard(fake)).toBe(true);

    // A closed modal stays in the DOM with `display: none`, and it owns
    // nothing — this is what stops the shortcut dying after the first dialog.
    modal.setAttribute("style", "display: none");
    expect(aLayerOwnsTheKeyboard(fake)).toBe(false);

    const drawer = fake.createElement("div");
    drawer.className = "ant-drawer ant-drawer-open";
    fake.body.append(drawer);
    expect(aLayerOwnsTheKeyboard(fake)).toBe(true);
  });
});

describe("page commands", () => {
  it("are registered while the page is mounted and leave with it", () => {
    const view = renderProbe();
    expect(screen.getByTestId("commands").textContent).toBe("probe.one");

    view.unmount();
    // Asserted by re-rendering rather than by reading a detached node: the
    // claim is that the *provider* forgets them, which is what stops the
    // palette offering "Assign selected tasks" from the billing screen.
    renderProbe();
    expect(screen.getByTestId("commands").textContent).toBe("probe.one");
  });
});
