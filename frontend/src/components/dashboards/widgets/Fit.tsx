import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A chart as tall as the card has room for.
 *
 * Fixed heights (160, 130) were drawn into cards of any size, so a two-row
 * card with a subtitle cut its donut in half and a gauge's tick labels landed
 * on its own figure (audit A). The box is measured; the chart follows it,
 * never shorter than `min`, and the old fixed height is the first guess.
 */
export function Fit({ min = 90, guess, children }: { min?: number; guess: number; children: (height: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(guess);
  useEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry?.contentRect.height ?? 0);
      if (next > 0) setHeight(Math.max(min, next));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [min]);
  return (
    <div ref={ref} className="nu-widget-fit">
      {children(height)}
    </div>
  );
}
