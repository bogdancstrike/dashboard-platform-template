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

  // Ctrl/Cmd-K from anywhere, and never while somebody is typing into a field —
  // a palette that steals the keystroke mid-sentence is worse than no shortcut.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((current) => !current);
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
