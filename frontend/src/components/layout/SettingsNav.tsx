import { useState } from "react";

/**
 * The design's settings rail: the page's sections, the current one lit. A
 * press scrolls to its card; the cards stay one column beside it, so every
 * setting reads as label on the left, control on the right.
 */
export function SettingsNav({ sections, label }: { sections: Array<[string, string]>; label: string }) {
  const [current, setCurrent] = useState(sections[0]?.[0] ?? "");
  return (
    <nav className="nx-fd-setnav nx-glass" aria-label={label}>
      {sections.map(([id, title]) => (
        <a
          key={id}
          href={`#${id}`}
          className={current === id ? "is-on" : ""}
          aria-current={current === id ? "true" : undefined}
          onClick={(event) => {
            event.preventDefault();
            setCurrent(id);
            document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          {title}
        </a>
      ))}
    </nav>
  );
}
