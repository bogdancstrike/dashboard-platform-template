import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { mondayOf, timeApi, type TimeEntry, type WeekRow } from "@/api/time";
import { useAuth } from "@/auth/AuthProvider";
import { errorText, errorToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

/** One person's week: its grid, the cell writes, submitting and removing entries. */
export function useWeekView(params: URLSearchParams) {
  const auth = useAuth();
  const { message } = App.useApp();
  const client = useQueryClient();
  const weekParam = params.get("week") ?? mondayOf();
  const userParam = params.get("user") ?? "";
  const mine = !userParam || userParam === auth.profile?.user.id;
  const [logging, setLogging] = useState<{ open: boolean; entry?: TimeEntry | null; day?: string }>({ open: false });
  const [extraRows, setExtraRows] = useState<WeekRow[]>([]);
  const [adding, setAdding] = useState(false);

  const week = useQuery({
    queryKey: queryKeys.time("week", weekParam, mine ? "" : userParam),
    queryFn: ({ signal }) => timeApi.week({ week: weekParam, user_id: mine ? undefined : userParam }, signal),
  });

  useEffect(() => setExtraRows([]), [weekParam, userParam]);

  const cell = useMutation({
    mutationFn: timeApi.cell,
    onSuccess: (next) => {
      client.setQueryData(queryKeys.time("week", weekParam, ""), next);
      void client.invalidateQueries({ queryKey: queryKeys.time("timer") });
    },
    onError: (error) => {
      message.error(errorText(error, { action: "change this cell" }));
      void week.refetch();
    },
  });

  const submit = useMutation({
    mutationFn: (note: string) => timeApi.submit({ week: weekParam, note }),
    onSuccess: (next) => {
      client.setQueryData(queryKeys.time("week", weekParam, ""), next);
      void client.invalidateQueries({ queryKey: queryKeys.notifications() });
      message.success("Week submitted for approval");
    },
    onError: errorToast(message, { action: "submit this week" }),
  });

  const remove = useMutation({
    mutationFn: timeApi.remove,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.time() });
      message.success("Entry removed");
    },
    onError: errorToast(message, { action: "remove this entry" }),
  });

  return { weekParam, mine, logging, setLogging, extraRows, setExtraRows, adding, setAdding, week, cell, submit, remove };
}
