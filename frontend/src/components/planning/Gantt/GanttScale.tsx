import { ticks, type Zoom } from "../gantt";

/** The two-row time scale over the chart, and the Today flag. */
export function GanttScale({
  scale,
  todayX,
  width,
  zoom,
  px,
}: {
  scale: ReturnType<typeof ticks>;
  todayX: number;
  width: number;
  zoom: Zoom;
  px: number;
}) {
  return (
    <div className="nx-pl-gantt-head">
      <div className="nx-pl-gantt-corner">Work</div>
      <div className="nx-pl-gantt-scale" style={{ width }}>
        <div className="nx-pl-gantt-major">
          {scale.major.map((tick) => (
            <span key={`M${tick.x}`} style={{ left: tick.x }}>
              {tick.label}
            </span>
          ))}
        </div>
        {todayX >= 0 && todayX <= width && (
          <span className="nx-pl-today-flag" style={{ left: todayX }}>
            Today
          </span>
        )}
        <div className="nx-pl-gantt-minor">
          {scale.minor.map((tick) => (
            <span
              key={`m${tick.x}`}
              className={tick.weekend ? "is-weekend" : undefined}
              style={{ left: tick.x, width: zoom === "day" ? px : undefined }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
