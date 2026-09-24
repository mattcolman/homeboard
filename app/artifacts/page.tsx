'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  LayoutGrid,
  PanelsTopLeft,
  Puzzle,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import {
  relativeTime,
  type ArtifactSummary,
  type Definition,
} from '../lib/widgets/model';
import { SiteNav } from '../components/SiteNav';
import './artifacts.css';

const KIND_ICON: Record<Definition['kind'], LucideIcon> = {
  page: PanelsTopLeft,
  module: Puzzle,
  composition: LayoutGrid,
  calendar: LayoutGrid,
  weather: LayoutGrid,
  shopping: LayoutGrid,
  recipe: LayoutGrid,
  library: LayoutGrid,
  chores: LayoutGrid,
};

export default function ArtifactsPage() {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/artifacts', { cache: 'no-store' });
      const data = (await response.json()) as {
        artifacts?: ArtifactSummary[];
        error?: string;
      };
      if (!response.ok)
        throw Error(data.error || 'Your visuals could not be loaded.');
      setArtifacts(data.artifacts ?? []);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Your visuals could not be loaded.',
      );
    }
  }, []);
  useEffect(() => {
    // The fetch resolves before it updates state.
    // oxlint-disable-next-line react-compiler/react-compiler
    void load();
  }, [load]);
  const remove = async (id: string) => {
    const response = await fetch('/api/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss', id }),
    });
    if (response.ok)
      setArtifacts((list) => list?.filter((a) => a.id !== id) ?? null);
  };
  return (
    <main className="artifacts-shell">
      <header className="artifacts-header">
        <Link href="/" className="artifacts-brand">
          <ArrowLeft />
          <span>
            <Sparkles />
          </span>
          <div>
            Artifacts<small>Your visual answers</small>
          </div>
        </Link>
        <SiteNav />
      </header>
      {error && <p className="artifacts-notice">{error}</p>}
      {!artifacts && !error && (
        <p className="artifacts-notice">Loading your visuals…</p>
      )}
      {artifacts && !artifacts.length && (
        <div className="artifacts-empty">
          <Sparkles />
          <h1>No visuals yet.</h1>
          <p>
            Ask Homeboard something like “how do plants grow” — the visual
            answer is saved here.
          </p>
        </div>
      )}
      {!!artifacts?.length && (
        <section className="artifacts-grid">
          {artifacts.map((a) => {
            const KindIcon = KIND_ICON[a.kind] ?? Sparkles;
            return (
              <Link
                key={a.id}
                href={`/artifacts/${a.id}`}
                className="artifact-card"
              >
                <span className="artifact-card-kind" aria-hidden>
                  <KindIcon />
                </span>
                <strong>{a.title}</strong>
                <small>{a.query}</small>
                <footer>
                  <time>{relativeTime(a.createdAt)}</time>
                  <button
                    className="artifact-card-delete"
                    aria-label={`Delete ${a.title}`}
                    title="Delete"
                    onClick={(event) => {
                      event.preventDefault();
                      void remove(a.id);
                    }}
                  >
                    <Trash2 />
                  </button>
                </footer>
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
