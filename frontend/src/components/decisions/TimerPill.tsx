import "@/styles/decisions.css";

import { Button, Input, Popover, Space, Switch, Typography } from "antd";
import { useState } from "react";
import { Link } from "react-router-dom";

import { clock, hours } from "@/api/time";
import { usePageCommands } from "@/commands/CommandContext";

import { SubjectPicker, parseSubjectKey } from "./SubjectPicker";
import { TdIcon } from "@/components/icons/TdIcon";
import { useTimer } from "./useTimer";
import { FEATURES, withFeature } from "@/settings/features";

const { Text } = Typography;

/**
 * The header's timer: the running clock from any page, and the way to start
 * or stop one without going to the timesheet. One running timer per person,
 * held by the server — so it survives a reload and agrees across tabs.
 */
function TimerPillInner() {
  const timer = useTimer();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [billable, setBillable] = useState(true);
  const [choice, setChoice] = useState<string | undefined>();

  usePageCommands("time:global", timer.allowed ? [
    {
      id: "time.timer",
      label: timer.running ? "Stop the running timer" : "Start a timer",
      keywords: "time track clock stopwatch log hours",
      run: () => (timer.running ? timer.stop.mutate({}) : setOpen(true)),
    },
  ] : []);

  if (!timer.allowed) return null;
  const running = timer.running;

  const content = running ? (
    <div className="nx-td-pop" data-testid="timer-popover">
      <div className="nx-td-pop-head">
        <span className="nx-td-pop-clock" data-testid="timer-popover-clock">{clock(timer.elapsed)}</span>
        <Text type="secondary">since {new Date(running.started_at ?? "").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
      </div>
      {running.link ? (
        <Link to={running.link} className="nx-td-pop-subject" onClick={() => setOpen(false)}>
          {running.subject_label}
        </Link>
      ) : (
        <span className="nx-td-pop-subject">{running.subject_label}</span>
      )}
      <Input.TextArea
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What you did (optional)"
        aria-label="Note for this time"
      />
      <Space>
        <Switch size="small" checked={billable} onChange={setBillable} aria-label="Billable" />
        <Text>Billable</Text>
      </Space>
      <Space wrap>
        <Button
          type="primary"
          danger
          icon={<TdIcon name="stop" size={14} />}
          loading={timer.stop.isPending}
          onClick={() =>
            timer.stop.mutate(
              { note, billable },
              { onSuccess: () => { setNote(""); setOpen(false); } },
            )
          }
          data-testid="timer-stop"
        >
          Stop and log
        </Button>
        <Link to="/time" onClick={() => setOpen(false)}>
          <Button>Open timesheet</Button>
        </Link>
      </Space>
    </div>
  ) : (
    <div className="nx-td-pop" data-testid="timer-popover">
      <Text strong>Start a timer</Text>
      <SubjectPicker value={choice} onChange={setChoice} autoFocus />
      <Space wrap>
        <Button
          type="primary"
          icon={<TdIcon name="play" size={14} />}
          disabled={!choice}
          loading={timer.start.isPending}
          onClick={() => {
            const subject = parseSubjectKey(choice);
            if (subject) timer.start.mutate(subject, { onSuccess: () => { setChoice(undefined); setOpen(false); } });
          }}
          data-testid="timer-start"
        >
          Start
        </Button>
        <Link to="/time" onClick={() => setOpen(false)}>
          <Button>Timesheet</Button>
        </Link>
      </Space>
      <Text type="secondary">{hours(timer.todayMinutes)} logged today</Text>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      content={content}
      destroyOnHidden
    >
      <button
        type="button"
        className={`nx-td-pill${running ? " is-running" : ""}`}
        aria-label={running ? `Timer running on ${running.subject_label ?? "a work item"}` : "Start a timer"}
        data-testid="timer-pill"
      >
        <span className="nx-td-pill-dot">
          <TdIcon name={running ? "stop" : "clock"} size={running ? 11 : 16} />
        </span>
        {running ? (
          <>
            <span className="nx-td-pill-clock" data-testid="timer-clock">{clock(timer.elapsed)}</span>
            <span className="nx-td-pill-label">{running.subject_label}</span>
          </>
        ) : (
          <span className="nx-td-pill-label">Timer</span>
        )}
      </button>
    </Popover>
  );
}

/** Rendered only while its feature flag is on (§27). */
export const TimerPill = withFeature(FEATURES.timeTracking, TimerPillInner);
