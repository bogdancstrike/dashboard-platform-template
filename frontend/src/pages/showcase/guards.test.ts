import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LAYERS, guardedLayers, unguardedLayers } from "@/pages/showcase/guards";
import { SRC, shippedSources } from "@/test/sources";

/**
 * Unsaved changes are protected where losing them costs something (§74).
 *
 * The tracker had this as "the record drawer asks before discarding" and
 * everything else silent — nineteen drawers and modals holding forms, one
 * guard between them. A dialog that throws away two minutes of typing on a
 * stray click outside it is the kind of defect nobody files, because the
 * person it happens to assumes they did something wrong.
 *
 * The declaration (`guards.ts`) says which layers guard and which deliberately
 * do not, with a reason either way, and this asserts it against the sources:
 *
 * * every module that renders a form inside a drawer or a modal is listed;
 * * a `guarded` one really uses the hook, and rewires *every* close path to it
 *   — a dialog that guards `onCancel` and not the drawer's own `onClose` is a
 *   dialog that guards the button nobody presses;
 * * the hook is the only implementation, so the copies cannot drift.
 */

const source = (path: string) => readFileSync(`${SRC}/${path}`, "utf8");

/** Modules rendering a form inside a layer that closes on Esc or a click away. */
function layersWithForms(): string[] {
  return shippedSources()
    .filter((file) => {
      const layered = /<Drawer|<Modal\b/.test(file.source);
      // `<Form` and not `Form.useForm`: a module may hold the instance for a
      // form its child renders.
      return layered && /<Form[\s>]/.test(file.source);
    })
    .map((file) => file.name)
    .sort();
}

describe("which dialogs ask before discarding", () => {
  it("accounts for every form inside a drawer or a modal", () => {
    const present = layersWithForms();
    // Guard against passing by looking at nothing.
    expect(present.length).toBeGreaterThan(12);
    const declared = new Set(LAYERS.map((layer) => layer.module));
    expect(present.filter((module) => !declared.has(module))).toEqual([]);
  });

  it("declares only modules that exist, and says why either way", () => {
    for (const layer of LAYERS) {
      expect(() => source(layer.module), layer.module).not.toThrow();
      // "Because it is small" is not a reason; the sentence has to say what
      // would be lost, or why nothing would.
      expect(layer.because.length, layer.module).toBeGreaterThan(60);
    }
  });

  it("has both answers in use, because a rule with one is a default", () => {
    expect(guardedLayers().length).toBeGreaterThan(10);
    expect(unguardedLayers().length).toBeGreaterThan(0);
  });

  it("really guards the ones it says it guards, on every close path", () => {
    for (const layer of guardedLayers()) {
      const text = source(layer.module);
      expect(text, layer.module).toContain("useDiscardGuard");
      // The dirty flag has to be armed by something, or the guard never fires.
      expect(/onValuesChange=\{touch\}|touch\(\)/.test(text), layer.module).toBe(true);

      // Every close path goes through the guard. A raw `onClose={onClose}` or
      // `onCancel={onClose}` beside a guard is the drawer's own X still
      // discarding silently — which is how three of these were written the
      // first time.
      const raw = [...text.matchAll(/on(?:Close|Cancel)=\{onClose\}/g)];
      expect(raw.map((match) => match[0]), `${layer.module} closes without asking`).toEqual([]);
    }
  });

  it("keeps one implementation of the question", () => {
    // A second `modal.confirm({ title: "Discard your changes?" })` anywhere is
    // a copy that will drift — one of them forgetting to reset the flag after
    // a save, and then asking the reader to confirm discarding changes they
    // have already saved.
    const copies = shippedSources(/\.tsx?$/)
      .filter((file) => file.source.includes("Discard your changes?"))
      .map((file) => file.name);

    expect(copies).toEqual(["hooks/useDiscardGuard.ts"]);
  });
});
