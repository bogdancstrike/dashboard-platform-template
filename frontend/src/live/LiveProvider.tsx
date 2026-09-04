import { useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { accessToken } from "@/api/client";
import type { Notification } from "@/api/notifications";
import { API_PREFIX } from "@/config";

/**
 * The live channel (§17): one WebSocket for the whole application.
 *
 * Three things this owns, and each of them is a decision rather than a detail:
 *
 * * **One socket, not one per screen.** The server fans out to every socket a
 *   user has open, so a page that opened its own would receive each
 *   notification twice and count it twice in the badge.
 * * **Reconnect with backoff, and give up loudly rather than quietly.** A
 *   corporate proxy that strips `Upgrade` produces a socket that never opens.
 *   The status this publishes is what makes the rest of the app poll instead —
 *   a notification centre that silently stops updating is worse than one that
 *   polls every thirty seconds.
 * * **Delivery is a hint, not the data.** A message invalidates the queries
 *   that own notifications rather than pushing a row into a cache the server
 *   is authoritative for. Two tabs, a reconnect that missed a message, an
 *   optimistic mark-read in flight — every one of those is a chance for a
 *   hand-merged cache to drift from what the server would answer.
 */
export type LiveStatus = "connecting" | "live" | "polling";

interface LiveContextValue {
  status: LiveStatus;
  /** True while the socket is not carrying updates, so callers must poll. */
  shouldPoll: boolean;
  /** How many messages this session has delivered — diagnostics and tests. */
  received: number;
}

const LiveContext = createContext<LiveContextValue>({
  status: "polling",
  shouldPoll: true,
  received: 0,
});

/** Reconnect delays, in milliseconds. The last one repeats. */
const BACKOFF = [1_000, 2_000, 5_000, 10_000, 30_000];

/** Cap on how long a socket may stay silent before it is treated as dead. */
const SILENCE_LIMIT_MS = 90_000;

function socketUrl(): string {
  const base = window.location.origin.replace(/^http/, "ws");
  return `${base}${API_PREFIX}/live`;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { notification: toast } = AntApp.useApp();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [received, setReceived] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const watchdogRef = useRef<number | undefined>(undefined);
  const closedByUs = useRef(false);

  const onMessage = useCallback(
    (raw: string) => {
      let payload: { type?: string; data?: Notification };
      try {
        payload = JSON.parse(raw) as { type?: string; data?: Notification };
      } catch {
        return;
      }
      if (payload.type !== "notification" || !payload.data) return;

      setReceived((count) => count + 1);
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });

      // A toast is the difference between "the badge changed while you were
      // looking elsewhere" and a notification you actually saw arrive. Kept
      // brief, bottom-right, and never for something the reader just did.
      toast.open({
        message: payload.data.title,
        description: payload.data.body ?? undefined,
        placement: "bottomRight",
        duration: 4,
        key: payload.data.id,
      });
    },
    [queryClient, toast],
  );

  useEffect(() => {
    // A mutable holder rather than a plain `let`: the teardown below flips it
    // while `connect` is suspended on its `await`, and a captured boolean is
    // something the type checker will happily narrow to "still false" across
    // that await — which is exactly the window this guard exists to cover.
    const alive = { current: true };
    // Read through a call, not as a plain reference: the teardown flips this
    // while `connect` is suspended on its `await`, and a narrowed reference
    // would be treated as "still true" for the rest of the function — exactly
    // the window these guards exist to cover.
    const running = () => alive.current;

    const clearTimers = () => {
      window.clearTimeout(timerRef.current);
      window.clearTimeout(watchdogRef.current);
    };

    /** Treat a socket that has said nothing at all — not even a ping — as gone. */
    const resetWatchdog = () => {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = window.setTimeout(() => {
        // Closing it ourselves routes through onclose and the normal backoff,
        // rather than inventing a second reconnect path.
        socketRef.current?.close();
      }, SILENCE_LIMIT_MS);
    };

    const scheduleReconnect = () => {
      if (!running()) return;
      const delay = BACKOFF[Math.min(attemptRef.current, BACKOFF.length - 1)] ?? 30_000;
      attemptRef.current += 1;
      timerRef.current = window.setTimeout(() => void connect(), delay);
    };

    const connect = async () => {
      if (!running()) return;
      let token: string | null = null;
      try {
        token = await accessToken();
      } catch {
        token = null;
      }
      if (!running()) return;
      if (!token) {
        // No credential yet — the app is still booting, or this is a test.
        // Polling covers it and a later attempt may succeed.
        setStatus("polling");
        scheduleReconnect();
        return;
      }

      let socket: WebSocket;
      try {
        // The subprotocol is the only header a browser lets a WebSocket carry,
        // so it is where the bearer token rides. `websocket.py` reads it from
        // exactly here.
        socket = new WebSocket(socketUrl(), ["bearer", token]);
      } catch {
        setStatus("polling");
        scheduleReconnect();
        return;
      }

      socketRef.current = socket;
      closedByUs.current = false;

      socket.onopen = () => {
        if (!running()) return;
        attemptRef.current = 0;
        setStatus("live");
        resetWatchdog();
        // A reconnect may have missed a message, so the first thing a fresh
        // socket does is ask for the truth rather than assume it is current.
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        resetWatchdog();
        if (event.data === "ping" || event.data.includes('"type": "ping"')) {
          try {
            socket.send("pong");
          } catch {
            /* the socket closed between the frame and the reply */
          }
          return;
        }
        onMessage(event.data);
      };

      socket.onerror = () => {
        // `onclose` always follows, and that is where reconnection is handled.
        // Doing it here as well is how a socket ends up with two pending
        // reconnects and then two sockets.
        setStatus("polling");
      };

      socket.onclose = () => {
        socketRef.current = null;
        window.clearTimeout(watchdogRef.current);
        if (!running() || closedByUs.current) return;
        setStatus("polling");
        scheduleReconnect();
      };
    };

    void connect();

    return () => {
      alive.current = false;
      closedByUs.current = true;
      clearTimers();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [onMessage, queryClient]);

  const value = useMemo<LiveContextValue>(
    () => ({ status, shouldPoll: status !== "live", received }),
    [status, received],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  return useContext(LiveContext);
}

/**
 * How often a query should poll, given the live channel's state.
 *
 * `false` while the socket is carrying updates — polling on top of a working
 * socket is the same data fetched twice — and the given interval when it is not.
 */
export function usePollInterval(whenPolling: number): number | false {
  const { shouldPoll } = useLive();
  return shouldPoll ? whenPolling : false;
}
