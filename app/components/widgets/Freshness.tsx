'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { isStale, relativeTime, type Snapshot } from '@/app/lib/widgets/model';

export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function Freshness({
  snapshot,
  offline,
  onRefresh,
}: {
  snapshot: Snapshot;
  offline: boolean;
  onRefresh?: () => void;
}) {
  const now = useNow();
  if (snapshot.source.startsWith('Example') || snapshot.source === 'Homeboard')
    return null;
  const rel = relativeTime(snapshot.fetchedAt, now),
    absolute = new Date(snapshot.fetchedAt).toLocaleString('en-AU', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  if (isStale(snapshot, now) && !offline && onRefresh)
    return (
      <button
        type="button"
        className="freshness-refresh"
        onClick={onRefresh}
        title={absolute}
      >
        <RefreshCw />
        Update due · {rel}
      </button>
    );
  return (
    <time dateTime={snapshot.fetchedAt} title={absolute}>
      {offline
        ? `Saved ${rel}`
        : isStale(snapshot, now)
          ? `Update due · ${rel}`
          : `Updated ${rel}`}
    </time>
  );
}
