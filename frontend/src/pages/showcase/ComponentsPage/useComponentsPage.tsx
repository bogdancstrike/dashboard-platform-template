
import { AppstoreOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { usePageCommands } from "@/commands/CommandContext";

import { ENTRIES, searchText } from "../docs/registry";

import { coverage } from "./inventory";

/** The search in the address, the section on screen, folded groups, and the palette. */
export function useComponentsPage() {
  const navigate = useNavigate();
  const found = useMemo(() => coverage(), []);
  // The search lives in the address, so a narrowed page can be shared.
  const [params, setParams] = useSearchParams();
  const term = params.get("q") ?? "";
  const setTerm = (value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set("q", value);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  const [active, setActive] = useState(ENTRIES[0]!.id);
  const main = useRef<HTMLDivElement>(null);

  const needle = term.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? ENTRIES.filter((entry) => searchText(entry).includes(needle)) : ENTRIES),
    [needle],
  );
  const demoCount = ENTRIES.reduce((sum, entry) => sum + entry.demos.length, 0);

  // A component's section is a place: its anchor is pushed, so back returns
  // to the one before, and a link to `#doc-table` lands on the table.
  const location = useLocation();
  const jump = (id: string) => {
    setActive(id);
    navigate({ search: location.search, hash: `#doc-${id}` });
  };
  useEffect(() => {
    const id = location.hash.replace(/^#doc-/, "");
    if (!id || id === location.hash) return;
    setActive(id);
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggleGroup = (group: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  // Which section is on screen, so the index can say where the reader is.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || !main.current) return;
    const observer = new IntersectionObserver(
      (records) => {
        const visible = records.filter((record) => record.isIntersecting);
        if (visible[0]) setActive(visible[0].target.id.replace(/^doc-/, ""));
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    main.current.querySelectorAll("section.nx-doc-section").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [shown]);

  usePageCommands("showcase-components", [
    ...ENTRIES.map((entry) => ({
      id: `showcase.doc.${entry.id}`,
      label: `Docs: ${entry.name}`,
      keywords: `${entry.group} ${entry.purpose} component documentation`,
      run: () => jump(entry.id),
    })),
    {
      id: "showcase.templates",
      label: "See the page templates instead",
      icon: <AppstoreOutlined />,
      keywords: "templates layouts gallery pages shapes",
      run: () => navigate("/showcase/templates"),
    },
  ]);

  return { found, term, setTerm, needle, active, main, shown, demoCount, jump, folded, setFolded, toggleGroup };
}
