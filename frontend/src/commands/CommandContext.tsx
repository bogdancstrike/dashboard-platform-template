import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Page-contributed commands (§31).
 *
 * The palette's first group is "On this page", and only the page knows what
 * belongs there. A page registers its actions on mount and they leave when it
 * unmounts, so the group is always about where the reader actually is — a
 * palette that offers "Assign selected tasks" from the billing screen is a
 * palette people stop trusting.
 */
export interface PageCommand {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Extra words the fuzzy match should consider — synonyms, abbreviations. */
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

interface CommandContextValue {
  commands: PageCommand[];
  register: (source: string, commands: PageCommand[]) => void;
  unregister: (source: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CommandContext = createContext<CommandContextValue | null>(null);

/** Whether this event came from somewhere a character belongs. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  // A checkbox or a radio takes no text, so `/` is free there — and the row
  // of tick boxes down a table's first column is exactly where a reader's
  // focus tends to be when they decide to search.
  const type = (target as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "file"].includes(type);
}

/**
 * Whether a modal or drawer currently owns the keyboard.
 *
 * A DOM check, because AntD owns the layer stack and does not publish it. The
 * alternative — every dialog in the product remembering to register itself —
 * is the kind of bookkeeping that is right in three places and forgotten in
 * the fourth.
 */
export function aLayerOwnsTheKeyboard(doc: Document = document): boolean {
  return Boolean(doc.querySelector(".ant-modal-wrap:not([style*='display: none']), .ant-drawer-open"));
}

export function CommandProvider({ children }: { children: ReactNode }) {
  const [bySource, setBySource] = useState<Record<string, PageCommand[]>>({});
  const [open, setOpen] = useState(false);

  const register = useCallback((source: string, commands: PageCommand[]) => {
    setBySource((current) => ({ ...current, [source]: commands }));
  }, []);

  const unregister = useCallback((source: string) => {
    setBySource((current) => {
      if (!(source in current)) return current;
      const next = { ...current };
      delete next[source];
      return next;
    });
  }, []);

  /**
   * The two ways in from the keyboard (§54).
   *
   * **Ctrl/Cmd-K works everywhere, including inside a field.** A chord is not
   * a character: intercepting it cannot interrupt a sentence, and a shortcut
   * that stopped working in the search box would stop working exactly where
   * somebody is already typing what they are looking for.
   *
   * **`/` works only when nothing is being typed.** It *is* a character, so
   * the guard is the whole feature — this comment claimed it for the chord and
   * nothing implemented it for either, which is how a promise in a comment
   * survives review. Editable elements are excluded, and so is anything inside
   * an open modal or drawer: while a layer owns the keyboard, a global
   * shortcut is a surprise.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target) || aLayerOwnsTheKeyboard()) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const commands = useMemo(() => Object.values(bySource).flat(), [bySource]);

  const value = useMemo(
    () => ({ commands, register, unregister, open, setOpen }),
    [commands, register, unregister, open],
  );

  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>;
}

export function useCommands(): CommandContextValue {
  const value = useContext(CommandContext);
  if (!value) throw new Error("useCommands must be used inside <CommandProvider>");
  return value;
}

/** Register this page's actions for as long as it is mounted. */
export function usePageCommands(source: string, commands: PageCommand[]): void {
  const { register, unregister } = useCommands();

  // Serialised rather than compared by reference: pages build these inline, so
  // a reference check would re-register on every render.
  const signature = commands.map((command) => `${command.id}:${command.label}`).join("|");

  useEffect(() => {
    register(source, commands);
    return () => unregister(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, signature, register, unregister]);
}
