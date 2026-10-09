import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { staleConnection } from './connection.js';
import { api } from './http.js';
import { applyLogEvent, type LogView, logChecked } from './log-state.js';
export function SiteLogPanel({
  projectId,
  workOrderId,
  generation,
}: {
  projectId: string;
  workOrderId: string;
  generation: number;
}) {
  const client = useQueryClient(),
    [open, setOpen] = useState(false),
    [paused, setPaused] = useState(false),
    [connection, setConnection] = useState('Disconnected'),
    [reconnect, setReconnect] = useState(0);
  const viewport = useRef<HTMLElement>(null);
  // Why the stream is being rebuilt, kept until it reconnects so the reason stays visible.
  const reason = useRef<string | null>(null);
  const path = `/blueprints/${encodeURIComponent(projectId)}/work-orders/${encodeURIComponent(workOrderId)}/log`;
  const query = useQuery({
    queryKey: ['site-log', projectId, workOrderId, generation],
    enabled: open,
    queryFn: async ({ signal }) => logChecked(await api(path, { signal })),
  });
  const data = query.error ? undefined : query.data;
  const ready = open && !!query.data && !query.error;
  useEffect(() => {
    if (!ready) {
      setConnection(reason.current ?? 'Disconnected');
      return;
    }
    const key = ['site-log', projectId, workOrderId, generation],
      current = client.getQueryData<LogView>(key);
    if (!current) return;
    let disposed = false,
      lastReceived = performance.now(),
      refreshing = false;
    const source = new EventSource(`/app/api${path}/events?since=${current.version}&connection=${reconnect}`);
    setConnection(reason.current ?? 'Connecting');
    const refresh = (reset = false, why = 'Refreshing record') => {
      if (refreshing || disposed) return;
      refreshing = true;
      source.close();
      reason.current = why;
      setConnection(why);
      void (reset ? client.resetQueries({ queryKey: key }) : client.invalidateQueries({ queryKey: key })).then(() => {
        if (!disposed) setReconnect((v) => v + 1);
      });
    };
    source.onopen = () => {
      lastReceived = performance.now();
      reason.current = null;
      setConnection('Connected');
    };
    source.onerror = () => {
      if (!disposed) setConnection('Disconnected · last received log');
    };
    source.addEventListener('heartbeat', () => {
      lastReceived = performance.now();
    });
    source.addEventListener('snapshot.required', () => refresh(true));
    source.addEventListener('authorization.required', () => refresh(true, 'Access needs checking'));
    source.addEventListener('site_log.line', (raw) => {
      if (disposed || refreshing) return;
      lastReceived = performance.now();
      try {
        const current = client.getQueryData<LogView>(key);
        if (!current) return refresh();
        // The generic event envelope includes metadata; the log applier accepts only its display fields.
        const e = JSON.parse((raw as MessageEvent<string>).data) as Record<string, unknown>;
        const next = applyLogEvent(current, { seq: e.seq, type: e.type, actor: e.actor, at: e.at, payload: e.payload });
        if (next === 'GAP') refresh();
        else client.setQueryData(key, next);
      } catch {
        refresh();
      }
    });
    const timer = window.setInterval(() => {
      if (staleConnection(lastReceived, performance.now())) refresh();
    }, 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      source.close();
    };
  }, [client, ready, projectId, workOrderId, generation, path, reconnect]);
  useEffect(() => {
    if (query.data && !paused && open && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [query.data, paused, open]);
  return (
    <section className="site-log" aria-label={`Site log for ${workOrderId}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide site log' : 'Show site log'}
      </button>
      {open && (
        <>
          <div className="log-heading">
            <h4>Site log</h4>
            <span className="connection">{connection}</span>
          </div>
          <p className="fine">Builder progress, not payment evidence. No real payment is executed.</p>
          <button type="button" aria-pressed={paused} onClick={() => setPaused((v) => !v)}>
            {paused ? 'Follow latest' : 'Pause scrolling'}
          </button>
          {query.isFetching && <p>Loading progress…</p>}
          {query.error && (
            <p className="error" role="alert">
              {query.error.message}
            </p>
          )}
          {data?.summary && (
            <p className="fine">
              {data.summary.count} earlier updates archived.{' '}
              {Object.entries(data.summary.kinds)
                .map(([kind, count]) => `${kind.replaceAll('_', ' ')}: ${count}`)
                .join(' · ')}
              .
            </p>
          )}
          {data && !data.lines.length && <p>No retained build updates yet.</p>}
          <section
            className="log-viewport"
            ref={viewport}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll this region without a pointer.
            tabIndex={0}
            aria-label="Build updates"
            onScroll={() => {
              const v = viewport.current;
              if (v && v.scrollHeight - v.scrollTop - v.clientHeight > 30) setPaused(true);
            }}
          >
            <ol>
              {data?.lines.map((entry) => (
                <li key={entry.seq}>
                  <span className="log-meta">
                    #{entry.seq} · {entry.line.kind.replaceAll('_', ' ')} ·{' '}
                    <time dateTime={entry.at}>{entry.at.slice(11, 19)} UTC</time>
                  </span>
                  <p>{entry.line.message}</p>
                  {'data' in entry.line && entry.line.kind === 'test_run' && (
                    <p>
                      {entry.line.data.passed} / {entry.line.data.total} tests passed
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </section>
  );
}
