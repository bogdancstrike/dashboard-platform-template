import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp } from "antd";

import { logsApi, type LogLine, type LogQuery } from "@/api/logs";
import { apiMessage } from "@/lib/errors";

import { POLL_MS } from "./logFormat";

export type LogFilters = Omit<LogQuery, "page" | "page_size">;

/**
 * Following the log: a poll every few seconds from a cursor, newest first.
 *
 * The tail's own rows are kept outside react-query: they are an append-only
 * stream rather than the answer to a question, and putting them in the cache
 * would make every poll a re-render of the whole page.
 */
export function useLogTail(filters: LogFilters) {
  const { message } = AntApp.useApp();
  const [live, setLive] = useState(false);
  const [streamed, setStreamed] = useState<LogLine[]>([]);
  const cursor = useRef<string | null>(null);
  const { q, min_level: minLevel, service, environment } = filters;

  /** One poll. Separate so both the interval and Resume can call it. */
  const poll = useCallback(async () => {
    try {
      const answer = await logsApi.tail({
        ...filters,
        ...(cursor.current ? { after: cursor.current } : {}),
      });
      cursor.current = answer.cursor;
      if (answer.items.length > 0) {
        // The server sends oldest-first so a client appends; this table is
        // newest-first, so they go on the front reversed.
        setStreamed((current) => [...[...answer.items].reverse(), ...current].slice(0, 500));
      }
    } catch (error) {
      // A failed poll stops the tail rather than retrying forever: a viewer
      // that silently kept failing would look like a quiet system.
      setLive(false);
      message.error(apiMessage(error, "The tail stopped — it could not be read."));
    }
    // `filters` is rebuilt each render; the fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, minLevel, service, environment, message]);

  useEffect(() => {
    if (!live) return;
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, poll]);

  // Changing the question while live restarts the stream: keeping rows that no
  // longer match the filter would be a table showing what it says it is not.
  useEffect(() => {
    if (live) {
      cursor.current = null;
      setStreamed([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, minLevel, service, environment]);

  return { live, setLive, streamed };
}
