import { useEffect, useRef, useState } from 'react';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

/**
 * ADR-002 solution design, section 7: one EventSource per screen, latest snapshot in state,
 * polling every 15 s after 3 errors in a row or 45 s of silence, and the stream retried every 60 s.
 */
export function useLiveStream<T>(opts: {
  url: string | null;
  events: string[];
  poll: () => Promise<T>;
  onEvent?: (event: string, data: any) => void;
  isNewer?: (next: T, current: T | null) => boolean;
  closeWhenHiddenMs?: number;
}) {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const ref = useRef(opts);
  ref.current = opts;
  const dataRef = useRef<T | null>(null);

  useEffect(() => {
    if (!opts.url) return;
    let es: EventSource | null = null;
    let errors = 0;
    let lastMessage = Date.now();
    let pollTimer: number | undefined;
    let retryTimer: number | undefined;
    let hiddenTimer: number | undefined;
    let stopped = false;

    const accept = (event: string, value: any) => {
      lastMessage = Date.now();
      if (event === ref.current.events[0]) {
        if (ref.current.isNewer && !ref.current.isNewer(value, dataRef.current)) return;
        dataRef.current = value;
        setData(value);
        setUpdatedAt(new Date());
      }
      ref.current.onEvent?.(event, value);
    };

    const startPolling = () => {
      if (pollTimer) return;
      setStatus('reconnecting');
      const tick = async () => {
        try {
          accept(ref.current.events[0], await ref.current.poll());
        } catch {
          /* keep showing the last known state */
        }
      };
      void tick();
      pollTimer = window.setInterval(tick, 15_000);
      retryTimer = window.setTimeout(() => {
        stopPolling();
        open();
      }, 60_000);
    };
    const stopPolling = () => {
      if (pollTimer) window.clearInterval(pollTimer);
      if (retryTimer) window.clearTimeout(retryTimer);
      pollTimer = retryTimer = undefined;
    };

    const open = () => {
      if (stopped) return;
      es?.close();
      es = new EventSource(ref.current.url!, { withCredentials: true });
      es.onopen = () => {
        errors = 0;
        stopPolling();
        setStatus('live');
      };
      es.onerror = () => {
        errors++;
        setStatus('reconnecting');
        if (errors >= 3) {
          es?.close();
          startPolling();
        }
      };
      for (const ev of ref.current.events) es.addEventListener(ev, (m) => accept(ev, JSON.parse((m as MessageEvent).data)));
    };

    const silence = window.setInterval(() => {
      if (Date.now() - lastMessage > 45_000 && !pollTimer) {
        es?.close();
        startPolling();
      }
    }, 5_000);

    const onVisibility = () => {
      const ms = ref.current.closeWhenHiddenMs;
      if (!ms) return;
      if (document.hidden) {
        hiddenTimer = window.setTimeout(() => es?.close(), ms);
      } else {
        window.clearTimeout(hiddenTimer);
        if (!es || es.readyState === EventSource.CLOSED) open();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    open();
    return () => {
      stopped = true;
      es?.close();
      stopPolling();
      window.clearInterval(silence);
      window.clearTimeout(hiddenTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [opts.url]);

  return { data, status, updatedAt, setData };
}
