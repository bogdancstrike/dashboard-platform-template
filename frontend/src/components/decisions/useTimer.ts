import { App } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { timeApi, type SubjectType, type TimerState } from "@/api/time";
import { useAuth } from "@/auth/AuthProvider";
import { errorText } from "@/lib/errors";

export const TIMER_KEY = ["time", "timer"] as const;

/**
 * The one running timer, wherever it is shown — the header pill, a task, a
 * ticket. The server holds it, so a reload or a second tab shows the same
 * clock; this ticks locally between polls from the moment it started.
 */
export function useTimer() {
  const auth = useAuth();
  const allowed = auth.can("time.track");
  const client = useQueryClient();
  const { message } = App.useApp();
  const state = useQuery({
    queryKey: TIMER_KEY,
    queryFn: ({ signal }) => timeApi.timer(signal),
    enabled: allowed,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const running = state.data?.running ?? null;
  const startedAt = running?.started_at ? new Date(running.started_at).valueOf() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  const settle = (next: TimerState) => {
    client.setQueryData(TIMER_KEY, { ...(state.data ?? {}), running: next.running });
    void client.invalidateQueries({ queryKey: ["time"] });
  };

  const start = useMutation({
    mutationFn: (body: { subject_type: SubjectType; subject_id: string }) => timeApi.start(body),
    onSuccess: (next) => {
      settle(next);
      message.success(
        next.stopped
          ? `Switched — ${next.stopped.subject_label ?? "the previous timer"} was stopped`
          : "Timer started",
      );
    },
    onError: (error) => message.error(errorText(error, { action: "start a timer" })),
  });

  const stop = useMutation({
    mutationFn: (body: { note?: string; billable?: boolean } = {}) => timeApi.stop(body),
    onSuccess: (next) => {
      settle(next);
      message.success(`Logged ${next.stopped?.minutes ?? 0} min on ${next.stopped?.subject_label ?? "the work item"}`);
    },
    onError: (error) => message.error(errorText(error, { action: "stop the timer" })),
  });

  return { allowed, state, running, elapsed, start, stop, todayMinutes: state.data?.today_minutes ?? 0 };
}
